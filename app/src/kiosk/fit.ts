// FittedBox(fit: BoxFit.scaleDown): shrink a one-line label, tracking and all,
// until it fits the width its parent gives it. Never grows it.
function fitOne(el: HTMLElement): void {
  el.style.fontSize = '';
  el.style.letterSpacing = '';
  const parent = el.parentElement;
  if (!parent) return;
  const box = getComputedStyle(parent);
  const room = parent.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight);
  const width = el.getBoundingClientRect().width;
  if (width <= room || width === 0) return;
  const k = room / width;
  const own = getComputedStyle(el);
  el.style.fontSize = `${parseFloat(own.fontSize) * k}px`;
  const tracking = parseFloat(own.letterSpacing);
  if (!Number.isNaN(tracking)) el.style.letterSpacing = `${tracking * k}px`;
}

/** Fits every `[data-fit]` now, once fonts load, and on resize. */
export function fitLabels(root: ParentNode = document): void {
  const run = () => root.querySelectorAll<HTMLElement>('[data-fit]').forEach(fitOne);
  run();
  void document.fonts?.ready.then(run);
  window.addEventListener('resize', run);
}
