import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

/// `site/app.js` is the only script the storefront ships: the sticky bar, the
/// scroll reveals, and the map/street-view swap. It had no tests, so a selector
/// that stopped matching the markup would fail silently in production — the page
/// would still load, just without the behaviour.
///
/// These tests run the real `site/index.html` and `site/menu/index.html` through
/// the real `site/app.js`, so they fail if either the script or the markup it
/// depends on drifts.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const storefront = readFileSync(join(root, 'site', 'index.html'), 'utf8');
const menuPage = readFileSync(join(root, 'site', 'menu', 'index.html'), 'utf8');
const script = readFileSync(join(root, 'site', 'app.js'), 'utf8');

/// Both pages ship `app.js`, so both are exercised.
const pages = { index: storefront, menu: menuPage };

/// Boots the storefront in jsdom with the browser features app.js probes.
///
/// jsdom ships no `matchMedia` and no `IntersectionObserver`, so both are stubbed
/// here — which is also how the fallback branches get exercised.
function load({
  page = 'index',
  reducedMotion = false,
  intersectionObserver = true,
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

  window.eval(script);
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

test('index.html still loads the script these tests exercise', () => {
  assert.match(storefront, /<script src="\/app\.js" defer><\/script>/);
});

test('the menu page loads the same script', () => {
  assert.match(menuPage, /<script src="\/app\.js" defer><\/script>/);
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
  const menu = window.document.querySelector('.slip--menu');

  assert.equal(
    menu.classList.contains('is-in'),
    false,
    'nothing is revealed before it is seen',
  );
  assert.equal(observers.length, 2, 'the menu and the photo wall are watched');

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
