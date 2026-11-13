import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

/// `site/app.js` is the storefront's behaviour script: the sticky bar, the
/// scroll reveals, and the map/street-view swap. A tiny inline probe in each
/// <head> flags weak devices before the stylesheet loads; jsdom does not run
/// inline scripts, so these tests supply that flag themselves. A selector that
/// stopped matching the markup would fail silently in production otherwise.
///
/// These tests run the real `site/index.html` and `site/menu/index.html` through
/// the real `site/app.js`, so they fail if either the script or the markup it
/// depends on drifts.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const storefront = readFileSync(join(root, 'site', 'index.html'), 'utf8');
const menuPage = readFileSync(join(root, 'site', 'menu', 'index.html'), 'utf8');

const pages = { index: storefront, menu: menuPage };

function inlineStyleOf(html) {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1] : '';
}

function inlineScriptOf(html) {
  const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  return matches.length ? matches[matches.length - 1][1] : '';
}

/// Boots the storefront in jsdom with the browser features app.js probes.
///
/// jsdom ships no `matchMedia` and no `IntersectionObserver`, so both are stubbed
/// here — which is also how the fallback branches get exercised.
function load({
  page = 'index',
  reducedMotion = false,
  intersectionObserver = true,
  lite = false,
} = {}) {
  const dom = new JSDOM(pages[page], {
    runScripts: 'outside-only',
    url: 'https://lunabitesanddelights.test/',
  });
  const { window } = dom;

  window.matchMedia = (query) => ({
    matches: reducedMotion && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });

  const observers = [];
  if (intersectionObserver) {
    window.IntersectionObserver = class {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.watched = [];
        this.disconnected = false;
        observers.push(this);
      }
      observe(element) {
        this.watched.push(element);
      }
      unobserve() {}
      disconnect() {
        this.disconnected = true;
      }
      takeRecords() {
        return [];
      }
    };
  }

  if (lite) window.document.documentElement.setAttribute('data-lite', '');
  window.eval(inlineScriptOf(pages[page]));
  return { window, observers };
}

/// jsdom's `scrollY` is read-only, so the scroll position is faked per test.
function scrollTo(window, value) {
  Object.defineProperty(window, 'scrollY', {
    value,
    configurable: true,
    writable: true,
  });
  window.dispatchEvent(new window.Event('scroll'));
}

test('both pages inline their script and stylesheet with no external CSS/JS or cache-busting params', () => {
  for (const [name, html] of Object.entries(pages)) {
    assert.ok(inlineScriptOf(html).length > 100, `${name} must inline its behaviour script`);
    assert.doesNotMatch(html, /\/styles\.css/, `${name} must not request external styles.css`);
    assert.doesNotMatch(html, /\/app\.js/, `${name} must not request external app.js`);
    assert.doesNotMatch(html, /\?v=\d+/, `${name} must not carry cache-busting query strings`);
  }
});

test('inline style blocks have valid balanced CSS', () => {
  const checkBalanced = (css, name) => {
    const open = (css.match(/\{/g) || []).length;
    const close = (css.match(/\}/g) || []).length;
    assert.ok(open > 10, `${name} must contain CSS rules`);
    assert.equal(open, close, `${name} must have balanced braces`);
    assert.match(css, /\{[^{}]*:[^{}]+\}/, `${name} must contain valid property:value declarations`);
  };
  for (const [name, html] of Object.entries(pages)) {
    const css = inlineStyleOf(html);
    assert.ok(css.length > 0, `${name} must have inline <style>`);
    checkBalanced(css, `${name} inline <style>`);
  }
});

test('the menu page keeps the bar and reveal behaviour', () => {
  const { window } = load({ page: 'menu' });
  const doc = window.document;

  const bar = doc.querySelector('.bar');
  assert.ok(bar, 'site/menu/index.html must keep a .bar for the sticky state');
  assert.ok(
    doc.querySelector('.slip--menu'),
    'site/menu/index.html must keep .slip--menu for the reveal',
  );
  assert.ok(
    doc.querySelector('.slip--menu .menu__cols'),
    'site/menu/index.html must keep .menu__cols inside .slip--menu for the reveal',
  );
  assert.equal(
    doc.documentElement.classList.contains('js-motion'),
    true,
    'the menu page engages the reveal styles',
  );

  scrollTo(window, 200);
  assert.equal(bar.classList.contains('is-stuck'), true, 'the bar sticks here too');
});

test('the bar only sticks once the page has scrolled', () => {
  const { window } = load();
  const bar = window.document.querySelector('.bar');
  assert.ok(bar, 'index.html must keep a .bar for the sticky state');
  assert.equal(bar.classList.contains('is-stuck'), false, 'unstuck at the top');

  scrollTo(window, 200);
  assert.equal(bar.classList.contains('is-stuck'), true, 'sticks once scrolled');

  scrollTo(window, 0);
  assert.equal(bar.classList.contains('is-stuck'), false, 'releases at the top');
});

test('reduced motion hides nothing and writes no reveal state', () => {
  const { window } = load({ reducedMotion: true });
  const doc = window.document;

  assert.equal(
    doc.documentElement.classList.contains('js-motion'),
    false,
    'the reveal styles must never engage under reduced motion',
  );
  assert.equal(
    doc.querySelector('.slip--hero .field').style.getPropertyValue('--w'),
    '',
    'the handwritten lines keep their natural order',
  );
  assert.equal(
    doc.querySelector('.slip--menu').classList.contains('is-in'),
    false,
    'the menu stays visible through the stylesheet, not a reveal class',
  );
});

test('without IntersectionObserver the menu and photos appear at once', () => {
  const { window } = load({ intersectionObserver: false });
  const doc = window.document;

  assert.equal(doc.documentElement.classList.contains('js-motion'), true);
  assert.equal(
    doc.querySelector('.slip--menu').classList.contains('is-in'),
    true,
    'the menu is revealed without waiting for a scroll',
  );
  assert.equal(doc.querySelector('.window').classList.contains('is-in'), true);
});

test('with IntersectionObserver the reveal waits for the section to arrive', () => {
  const { window, observers } = load();
  const doc = window.document;
  const menu = doc.querySelector('.slip--menu');

  assert.equal(
    menu.classList.contains('is-in'),
    false,
    'nothing is revealed before it is seen',
  );
  assert.equal(observers.length, 2, 'the menu and the photo wall are watched');

  // The watch targets, not just the count, and anchored to their section: app.js
  // falls back to the target when its watch selector misses, so a renamed or
  // relocated .menu__cols would still fire on the wrong element.
  assert.equal(
    observers[0].watched[0],
    doc.querySelector('.slip--menu .menu__cols'),
    'the menu is watched through .menu__cols inside .slip--menu',
  );
  assert.equal(
    observers[1].watched[0],
    doc.querySelector('.window .window__wall'),
    'the photo wall is watched through .window__wall inside .window',
  );

  const [menuObserver] = observers;
  menuObserver.callback([{ isIntersecting: true }], menuObserver);

  assert.equal(menu.classList.contains('is-in'), true);
  assert.equal(
    menuObserver.disconnected,
    true,
    'the observer stops once it has done its job',
  );
});

test('a section that never intersects stays unrevealed', () => {
  const { window, observers } = load();
  const menu = window.document.querySelector('.slip--menu');

  observers[0].callback([{ isIntersecting: false }], observers[0]);

  assert.equal(menu.classList.contains('is-in'), false);
  assert.equal(observers[0].disconnected, false, 'still watching');
});

test('the map and street view swap one at a time', () => {
  const { window } = load();
  const doc = window.document;
  const mapTab = doc.querySelector('[data-show="map"]');
  const streetTab = doc.querySelector('[data-show="street"]');
  const mapPanel = doc.querySelector('[data-panel="map"]');
  const streetPanel = doc.querySelector('[data-panel="street"]');

  assert.equal(doc.documentElement.classList.contains('js-view'), true);
  assert.equal(mapTab.getAttribute('aria-pressed'), 'true', 'map is the default');
  assert.equal(streetTab.getAttribute('aria-pressed'), 'false');
  assert.equal(mapPanel.classList.contains('is-active'), true);
  assert.equal(streetPanel.classList.contains('is-active'), false);

  streetTab.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(streetTab.getAttribute('aria-pressed'), 'true');
  assert.equal(mapTab.getAttribute('aria-pressed'), 'false');
  assert.equal(streetPanel.classList.contains('is-active'), true);
  assert.equal(mapPanel.classList.contains('is-active'), false);

  mapTab.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(mapTab.getAttribute('aria-pressed'), 'true');
  assert.equal(mapPanel.classList.contains('is-active'), true);
  assert.equal(streetPanel.classList.contains('is-active'), false);
});

test('a weak device keeps every line visible and starts no observers', () => {
  const { window, observers } = load({ lite: true });
  const doc = window.document;

  assert.equal(doc.documentElement.classList.contains('js-motion'), false);
  assert.equal(doc.querySelector('.slip--hero .field').style.getPropertyValue('--w'), '');
  assert.equal(observers.length, 0, 'no IntersectionObserver work on a weak device');
  assert.equal(doc.querySelector('.slip--menu').classList.contains('is-in'), false);
});

test('both pages flag weak devices before the stylesheet', () => {
  for (const [name, html] of Object.entries(pages)) {
    assert.match(html, /data-lite/, `${name} must carry the capability probe`);
    assert.match(html, /navigator\.connection/, `${name} must check the connection`);
    assert.ok(
      html.indexOf('data-lite') < html.indexOf('<style>'),
      `${name} must flag weak devices before inline styles`,
    );
  }
});

test('font preloads match the inline stylesheet so each font is fetched once', () => {
  for (const [name, html] of Object.entries(pages)) {
    const preload = html.match(/<link rel="preload" href="([^"]+\.woff2[^"]*)" as="font"/);
    assert.ok(preload, `${name} must preload the display font`);
    assert.ok(
      inlineStyleOf(html).includes(`url('${preload[1]}')`),
      `${name} preload must point at the exact URL in inline <style>`,
    );
  }
});

test('the hero logo is responsive and the hidden bar logo is not preloaded', () => {
  assert.doesNotMatch(storefront, /rel="preload"[^>]*luna-logo-320\.webp/);
  assert.match(
    storefront,
    /class="slip__logo"[^>]*srcset="\/img\/luna-logo-320\.webp 320w, \/img\/luna-logo-640\.webp 640w"/,
  );
  assert.match(storefront, /sizes="\(max-width: 700px\) 112px, 236px"/);
});

test('the street view embed is fetched only when its tab is chosen', () => {
  const { window } = load();
  const doc = window.document;
  const frame = doc.querySelector('[data-panel="street"] iframe');
  assert.ok(frame, 'the street view iframe stays in the markup');
  assert.equal(frame.getAttribute('src'), null, 'no map request on a slow first visit');
  const deferred = frame.getAttribute('data-src') ?? '';
  assert.match(deferred, /^https:\/\/www\.google\.com\/maps\/embed/);

  doc.querySelector('[data-show="street"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(frame.getAttribute('src'), deferred, 'choosing the tab starts the embed');

  doc.querySelector('[data-show="map"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(frame.getAttribute('src'), deferred, 'switching back does not refetch it');
});

test('without script the street view still offers a way out', () => {
  assert.match(storefront, /<noscript>[\s\S]*Open street view in Maps[\s\S]*<\/noscript>/);
});

test('staff login link remains visible in the header and is not hidden in CSS', () => {
  assert.match(storefront, /<a class="bar__staff" href="\/kiosk\/#\/staff">Staff login<\/a>/);
  assert.match(menuPage, /<a class="bar__staff" href="\/kiosk\/#\/staff">Staff login<\/a>/);
  for (const [name, html] of Object.entries(pages)) {
    assert.doesNotMatch(inlineStyleOf(html), /\.bar__staff\s*\{[^}]*display:\s*none/, `${name} must not hide .bar__staff`);
  }
});

test('the bar publishes its measured height to --bar-h for scroll-margin-top', () => {
  const { window } = load();
  const doc = window.document;
  const bar = doc.querySelector('.bar');
  bar.getBoundingClientRect = () => ({ height: 110 });
  window.dispatchEvent(new window.Event('resize'));

  assert.equal(doc.documentElement.style.getPropertyValue('--bar-h'), '110px');
  assert.match(inlineStyleOf(storefront), /scroll-margin-top:\s*calc\(var\(--bar-h,/);
});
