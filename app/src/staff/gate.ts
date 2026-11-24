// Every staff screen sits behind the sign-in gate until the session is staff.
import { mountLogin } from './login.ts';
import { currentStaff, watchStaff, type Staff } from './session.ts';
import { closeAllDialogs } from './ui.ts';

type Mount = (root: HTMLElement, staff: () => Staff | null) => (() => void) | void;

let swRegistered = false;

/** Registers the staff PWA service worker immediately if load already fired, else on load. */
export function registerStaffServiceWorker(
  win: Pick<Window, 'addEventListener'> = window,
  doc: Pick<Document, 'readyState'> = document,
  nav: { serviceWorker?: { register: (url: string, opts?: { scope?: string }) => Promise<unknown> } } | undefined =
    typeof navigator !== 'undefined' ? navigator : undefined,
): boolean {
  const sw = nav?.serviceWorker;
  if (!sw) return false;
  const register = () => {
    try {
      void sw.register('/staff/sw.js', { scope: '/staff/' }).catch(() => {});
    } catch {
      // Ignore synchronous registration errors so the staff UI still mounts.
    }
  };
  if (doc.readyState === 'complete') register();
  else win.addEventListener('load', register, { once: true });
  return true;
}

export function gate(root: HTMLElement, mount: Mount): void {
  if (!swRegistered) {
    swRegistered = registerStaffServiceWorker();
  }
  let shown: 'login' | 'screen' | null = null;
  let dispose: (() => void) | void;
  watchStaff((staff) => {
    const want = staff ? 'screen' : 'login';
    if (want === shown) return;
    closeAllDialogs();
    dispose?.();
    dispose = undefined;
    shown = want;
    document.body.classList.toggle('is-gated', !staff);
    if (staff) dispose = mount(root, currentStaff);
    else dispose = mountLogin(root);
  });
}
