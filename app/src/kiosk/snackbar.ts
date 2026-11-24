// ScaffoldMessenger.showSnackBar with the kiosk SnackBarTheme: floating, ink,
// paper text, 6px corners. One at a time; a new one replaces the last.
let current: { el: HTMLElement; timer: number } | null = null;

export interface SnackOptions {
  color?: string;
  seconds?: number;
  action?: string;
  icon?: string;
  /** Staff snacks: square corners, 13px bold text. */
  square?: boolean;
  /** Bottom offset for pages whose own bottom bar would sit under the snack. */
  bottom?: string;
}

export function snack(message: string, { color, seconds = 4, action, icon, square, bottom }: SnackOptions = {}): void {
  if (current) {
    clearTimeout(current.timer);
    current.el.remove();
  }
  const el = document.createElement('div');
  el.className = square ? 'snack snack--square' : 'snack';
  el.setAttribute('role', 'status');
  if (color) el.style.background = color;
  if (bottom) el.style.bottom = bottom;
  if (icon) {
    const i = document.createElement('span');
    i.className = 'icon snack__icon';
    i.setAttribute('aria-hidden', 'true');
    i.textContent = icon;
    el.append(i);
  }
  const text = document.createElement('span');
  text.className = 'snack__text';
  text.textContent = message;
  el.append(text);
  const close = () => {
    if (current?.el !== el) return;
    clearTimeout(current.timer);
    el.remove();
    current = null;
  };
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'snack__action';
    b.textContent = action;
    b.addEventListener('click', close);
    el.append(b);
  }
  document.body.append(el);
  current = { el, timer: window.setTimeout(close, seconds * 1000) };
}
