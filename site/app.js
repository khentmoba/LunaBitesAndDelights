/* Sticky bar state: the small logo joins the bar once the slip's own logo scrolls away. */
(function () {
  'use strict';
  var bar = document.querySelector('.bar');
  if (!bar) return;

  var stuck = false;
  var onScroll = function () {
    var next = window.scrollY > 6;
    if (next !== stuck) {
      stuck = next;
      bar.classList.toggle('is-stuck', stuck);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* The cashier writes the first slip, then the stamps land as the menu and photos arrive.
   Hidden states exist only once this runs, so without script, on a weak device, or on
   slow data every line, price and photograph stays on the page from the first paint. */
(function () {
  'use strict';
  var root = document.documentElement;
  var connection = navigator.connection || {};
  var lite = root.hasAttribute('data-lite') ||
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
    connection.saveData === true ||
    /^(slow-)?2g$|^3g$/.test(connection.effectiveType || '');

  if (lite) {
    root.classList.remove('js-motion');
    return;
  }

  var written = document.querySelectorAll('.slip--hero .field, .slip--hero .lines tbody tr');
  for (var i = 0; i < written.length; i++) written[i].style.setProperty('--w', i);

  root.classList.add('js-motion');
  if (!('IntersectionObserver' in window)) {
    [].forEach.call(document.querySelectorAll('.slip--menu, .window'), function (el) { el.classList.add('is-in'); });
    return;
  }

  var arrive = function (selector, watchSelector) {
    var target = document.querySelector(selector);
    var watch = document.querySelector(watchSelector) || target;
    if (!target) return;
    var observer = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      target.classList.add('is-in');
      observer.disconnect();
    }, { threshold: 0.15 });
    observer.observe(watch);
  };

  arrive('.slip--menu', '.menu__cols');
  arrive('.window', '.window__wall');
})();

/* Find us: the map or the street view, one at a time. The street view embed is only
   fetched when its tab is chosen, so a slow first visit never pays for both maps. */
(function () {
  'use strict';
  var view = document.querySelector('.locate');
  if (!view) return;

  var tabs = [].slice.call(view.querySelectorAll('[data-show]'));
  var panels = [].slice.call(view.querySelectorAll('[data-panel]'));

  var show = function (name) {
    tabs.forEach(function (tab) {
      tab.setAttribute('aria-pressed', String(tab.getAttribute('data-show') === name));
    });
    panels.forEach(function (panel) {
      var active = panel.getAttribute('data-panel') === name;
      panel.classList.toggle('is-active', active);
      if (!active) return;
      var frame = panel.querySelector('iframe[data-src]');
      if (frame && !frame.getAttribute('src')) {
        frame.setAttribute('src', frame.getAttribute('data-src'));
      }
    });
  };

  document.documentElement.classList.add('js-view');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      show(tab.getAttribute('data-show'));
    });
  });
  show('map');
})();
