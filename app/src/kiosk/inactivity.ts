// Inactivity watcher: after two idle
// minutes, warn for 15 seconds, then clear the order and go back to the splash.
import { cart } from './cart.ts';
import { DRAFT, PENDING, RECEIPT, save } from './handoff.ts';
import { kioskSession } from './session.ts';

const TIMEOUT_MS = 2 * 60 * 1000;
const COUNTDOWN_S = 15;

export function resetKiosk(): void {
  cart.clear();
  kioskSession.reset();
  save(DRAFT, null);
  save(PENDING, null);
  save(RECEIPT, null);
  location.replace('/kiosk/');
}

export interface WatchInactivityOptions {
  pauseWhenHidden?: boolean;
}

export function watchInactivity(timeoutMs = TIMEOUT_MS, options: WatchInactivityOptions = {}): void {
  const { pauseWhenHidden = false } = options;
  const dialog = document.createElement('dialog');
  dialog.className = 'idle';
  dialog.setAttribute('aria-labelledby', 'idle-title');
  dialog.innerHTML = `<h2 class="idle__title" id="idle-title">ARE YOU STILL THERE?</h2>
<p class="idle__body">This kiosk will automatically reset to the main screen in:</p>
<div class="idle__count" aria-live="polite" data-idle-count>${COUNTDOWN_S}</div>
<button type="button" class="btn-filled" data-idle-stay>YES, I AM HERE</button>`;
  document.body.append(dialog);
  const count = dialog.querySelector<HTMLElement>('[data-idle-count]')!;

  let idle = 0;
  let tick = 0;
  let lastArmed = 0;
  const arm = (force = false) => {
    if (dialog.open) return;
    if (pauseWhenHidden && document.hidden) {
      clearTimeout(idle);
      idle = 0;
      return;
    }
    const now = Date.now();
    if (!force && now - lastArmed < 1000) return;
    lastArmed = now;
    clearTimeout(idle);
    idle = window.setTimeout(warn, timeoutMs);
  };
  const warn = () => {
    if (dialog.open || (pauseWhenHidden && document.hidden)) return;
    clearInterval(tick);
    let left = COUNTDOWN_S;
    count.textContent = String(left);
    dialog.showModal();
    tick = window.setInterval(() => {
      if (left > 1) count.textContent = String(--left);
      else {
        clearInterval(tick);
        tick = 0;
        dialog.close();
        resetKiosk();
      }
    }, 1000);
  };
  dialog.addEventListener('cancel', (e) => e.preventDefault());
  dialog.querySelector('[data-idle-stay]')!.addEventListener('click', () => {
    clearInterval(tick);
    dialog.close();
    arm(true);
  });
  const onActivity = () => arm(false);
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const) {
    window.addEventListener(type, onActivity, { passive: true });
  }
  if (pauseWhenHidden) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearTimeout(idle);
        idle = 0;
        clearInterval(tick);
        tick = 0;
        if (dialog.open) dialog.close();
      } else {
        arm(true);
      }
    });
  }
  window.addEventListener('pagehide', () => {
    clearTimeout(idle);
    idle = 0;
    clearInterval(tick);
    tick = 0;
    if (dialog.open) dialog.close();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) arm(true);
  });
  arm(true);
}

/** Navigator.pop: back to the previous kiosk page, else to the given one. */
export function popTo(fallback: string): void {
  let ref: URL | null = null;
  if (document.referrer) {
    try {
      ref = new URL(document.referrer);
    } catch {
      ref = null;
    }
  }
  if (ref && ref.origin === location.origin && ref.pathname.startsWith('/kiosk') && history.length > 1) history.back();
  else location.assign(fallback);
}
