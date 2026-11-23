// Every staff screen sits behind the sign-in gate until the session is staff.
import { mountLogin } from './login.ts';
import { currentStaff, watchStaff, type Staff } from './session.ts';

type Mount = (root: HTMLElement, staff: () => Staff | null) => (() => void) | void;

let swRegistered = false;

export function gate(root: HTMLElement, mount: Mount): void {
  if (!swRegistered && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    swRegistered = true;
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/staff/sw.js', { scope: '/staff/' }).catch(() => {});
    });
  }
  let shown: 'login' | 'screen' | null = null;
  let dispose: (() => void) | void;
  watchStaff((staff) => {
    const want = staff ? 'screen' : 'login';
    if (want === shown) return;
    dispose?.();
    dispose = undefined;
    shown = want;
    document.body.classList.toggle('is-gated', !staff);
    if (staff) dispose = mount(root, currentStaff);
    else dispose = mountLogin(root);
  });
}
