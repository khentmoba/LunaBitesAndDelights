// Small DOM helpers shared by the staff screens.
import { glyph, type IconName } from '../kiosk/icons.ts';
import { snack } from '../kiosk/snackbar.ts';
export { esc } from '../kiosk/dom.ts';

/** A Material icon glyph span. */
export const icon = (name: IconName, cls = ''): string => `<span class="icon${cls ? ` ${cls}` : ''}" aria-hidden="true">${glyph(name)}</span>`;

/** The staff SnackBar: square, coloured, white 13px bold text, 3 s. */
export const staffSnack = (message: string, color: string, seconds = 3): void => snack(message, { color, seconds, square: true });

export const SUCCESS = '#1E7A3C';
export const ERROR = '#B3261E';
export const WARNING = '#B45309';
export const PLATE = '#D91566';
export const INK_SOFT = '#6B3A52';
export const INK = '#2A0F1E';

/** Dart's num.toString for a JSON number: whole numbers print without a fraction. */
export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
export const int = (v: unknown): number => Math.trunc(num(v));

/** Navigate within the staff app (or out of it). */
export const go = (path: string): void => location.assign(path);

/** Whether this page was opened from another page of the app, so the AppBar shows a back arrow. */
export function cameFromApp(): boolean {
  try {
    return document.referrer !== '' && new URL(document.referrer).origin === location.origin;
  } catch {
    return false;
  }
}

/** Opens a modal dialog built from `html`; it removes itself once closed. */
export function showDialog(html: string, cls = 'sdialog'): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.className = cls;
  d.innerHTML = html;
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  document.body.append(d);
  d.showModal();
  return d;
}

/** Runs each gradient exactly corner to corner (top-left to bottom-right) by setting the angle from the box's size. */
export function diagonals(scope: ParentNode): void {
  for (const el of scope.querySelectorAll<HTMLElement>('[data-ga]')) {
    const { width, height } = el.getBoundingClientRect();
    if (width && height) el.style.setProperty('--ga', `${180 - (Math.atan2(width, height) * 180) / Math.PI}deg`);
  }
}
