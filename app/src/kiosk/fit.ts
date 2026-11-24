// FittedBox(fit: BoxFit.scaleDown): shrink a one-line label, tracking and all,
// until it fits the width its parent gives it. Never grows it.
function fitBatch(nodes: HTMLElement[]): void {
  if (!nodes.length) return;
  for (const el of nodes) {
    el.style.fontSize = '';
    el.style.letterSpacing = '';
  }
  const updates: Array<{ el: HTMLElement; fontSize: string; letterSpacing: string | null }> = [];
  for (const el of nodes) {
    const parent = el.parentElement;
    if (!parent) continue;
    const box = getComputedStyle(parent);
    const room = parent.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight);
    const width = el.getBoundingClientRect().width;
    if (!(room > 0) || width <= room || width === 0) continue;
    const k = room / width;
    const own = getComputedStyle(el);
    const tracking = parseFloat(own.letterSpacing);
    updates.push({
      el,
      fontSize: `${parseFloat(own.fontSize) * k}px`,
      letterSpacing: Number.isNaN(tracking) ? null : `${tracking * k}px`,
    });
  }
  for (const u of updates) {
    u.el.style.fontSize = u.fontSize;
    if (u.letterSpacing !== null) u.el.style.letterSpacing = u.letterSpacing;
  }
}

/** Fits every `[data-fit]` now, once fonts load, and on resize. */
export function fitLabels(root: ParentNode = document): void {
  const run = () => fitBatch(Array.from(root.querySelectorAll<HTMLElement>('[data-fit]')));
  let raf = 0;
  const onResize = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      run();
    });
  };
  run();
  void document.fonts?.ready.then(run);
  window.addEventListener('resize', onResize);
}
