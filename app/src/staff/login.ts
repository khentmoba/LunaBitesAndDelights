// Staff sign-in: a quick PIN pad or
// a username and password, checked by the verifyStaff callable, which returns
// a custom token for the Firebase staff session.
import { callFn } from '../kiosk/firebase.ts';
import { glyph } from '../kiosk/icons.ts';
import { snack } from '../kiosk/snackbar.ts';
import { readPasswordCredentials } from './login-credentials.ts';
import { fnError, signInWithToken } from './session.ts';
import { esc, icon } from './ui.ts';

type Mode = 'pin' | 'password';

interface VerifyResult {
  success?: boolean;
  username?: string;
  role?: string;
  customToken?: string;
  message?: string;
}

/** Renders the gate into `root`; returns a cleanup function for listeners/timers. */
export function mountLogin(root: HTMLElement): () => void {
  let mode: Mode = 'pin';
  let pin = '';
  let user = '';
  let pass = '';
  let obscure = true;
  let loading = false;
  let error: string | null = null;
  let disposed = false;

  root.innerHTML = `
<div class="gate"><div class="login-wrap"><section class="login" aria-labelledby="login-title">
  <div class="login__strip"></div>
  <div class="login__body" data-body></div>
</section></div></div>`;
  const body = root.querySelector<HTMLElement>('[data-body]')!;

  const cancel = () => location.assign('/kiosk/menu');

  function render(focus?: string) {
    const canSubmit = pin.length >= 4;
    const slots = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<span class="login__slot${i < pin.length ? ' login__slot--on' : ''}"></span>`).join('');
    const digit = (d: string) => `<button type="button" class="key" data-digit="${d}" aria-label="${d}"${loading ? ' disabled' : ''}>${d}</button>`;
    const tab = (m: Mode, name: 'pin_rounded' | 'badge_rounded', label: string) =>
      `<button type="button" class="login__tab" data-mode="${m}" aria-pressed="${mode === m}">${icon(name)}<span>${label}</span></button>`;

    const pinPad = `
  <div class="login__section">
    <p class="login__pinlabel">ENTER 4–8 DIGIT PIN</p>
    <div class="login__slots" aria-label="${pin.length} digits entered" role="img">${slots}</div>
    <div class="keypad">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit).join('')}
      <button type="button" class="key" data-back aria-label="Backspace"${loading ? ' disabled' : ''}>${icon('backspace_outlined')}</button>
      ${digit('0')}
      <button type="button" class="key key--go${canSubmit ? ' is-ready' : ''}" data-submit aria-label="Submit PIN"${loading || !canSubmit ? ' disabled' : ''}>${loading ? '<span class="login__spin"></span>' : icon('arrow_forward_rounded')}</button>
    </div>
  </div>
  <button type="button" class="login__cancel" data-cancel${loading ? ' disabled' : ''}>CANCEL &amp; RETURN TO KIOSK</button>`;

    const passwordForm = `
  <form class="login__section" data-form novalidate>
    <label class="login__field"><span class="login__label">USERNAME</span>
      <span class="login__input">${icon('person_outline_rounded')}<input name="user" autocomplete="username" autocapitalize="none" enterkeyhint="next" placeholder="Enter username" value="${esc(user)}"></span>
    </label>
    <label class="login__field"><span class="login__label">PASSWORD</span>
      <span class="login__input">${icon('lock_outline_rounded')}<input name="pass" type="${obscure ? 'password' : 'text'}" autocomplete="current-password" enterkeyhint="go" placeholder="••••••••" value="${esc(pass)}">
        <button type="button" class="login__eye" data-eye aria-label="${obscure ? 'Show password' : 'Hide password'}">${icon(obscure ? 'visibility_off_rounded' : 'visibility_rounded')}</button></span>
    </label>
    <div class="login__buttons">
      <button type="button" class="login__btn" data-cancel${loading ? ' disabled' : ''}>CANCEL</button>
      <button type="submit" class="login__btn login__btn--go"${loading ? ' disabled' : ''}>${loading ? '<span class="login__spin"></span>' : 'LOG IN'}</button>
    </div>
  </form>`;

    body.innerHTML = `
  <div class="login__logo"><img src="/kiosk/images/luna_logo.webp" alt="" width="42" height="50" decoding="async"></div>
  <h1 class="login__title" id="login-title">STAFF OPERATIONS</h1>
  <p class="login__sub">Kitchen Display System &amp; Dispatch Board</p>
  <div class="login__tabs">${tab('pin', 'pin_rounded', 'QUICK PIN')}${tab('password', 'badge_rounded', 'PASSWORD')}</div>
  ${error === null ? '' : `<div class="login__error" role="alert">${icon('error_outline_rounded')}<span>${esc(error)}</span></div>`}
  ${mode === 'pin' ? pinPad : passwordForm}`;

    if (focus) body.querySelector<HTMLElement>(focus)?.focus();
  }

  function setPin(next: string) {
    if (loading) return;
    const hadError = error !== null;
    pin = next;
    error = null;
    if (hadError || mode !== 'pin') {
      render();
      return;
    }
    const slotsEl = body.querySelector<HTMLElement>('.login__slots');
    const submitBtn = body.querySelector<HTMLButtonElement>('[data-submit]');
    if (!slotsEl || !submitBtn) {
      render();
      return;
    }
    const canSubmit = pin.length >= 4;
    slotsEl.setAttribute('aria-label', `${pin.length} digits entered`);
    slotsEl.innerHTML = Array.from(
      { length: Math.max(4, pin.length) },
      (_, i) => `<span class="login__slot${i < pin.length ? ' login__slot--on' : ''}"></span>`,
    ).join('');
    submitBtn.disabled = !canSubmit;
    submitBtn.classList.toggle('is-ready', canSubmit);
  }

  async function verify(params: Record<string, string>, fallbackUser: string, failure: string) {
    error = null;
    loading = true;
    render();
    try {
      const data = await callFn<VerifyResult>('verifyStaff', params, 30);
      if (disposed) return;
      if (data.success !== true) {
        error = data.message ?? failure;
        return;
      }
      const name = data.username ?? fallbackUser;
      const role = data.role ?? (name.toLowerCase() === 'admin' ? 'admin' : 'staff');
      if (!data.customToken) {
        error = 'Staff authentication token missing. Please try again.';
        return;
      }
      await signInWithToken(data.customToken);
      if (disposed) return;
      snack(`Welcome, ${name}! (${role.toUpperCase()})`, { color: 'var(--plate)', icon: glyph('verified_user_rounded'), square: true });
    } catch (e) {
      if (disposed) return;
      const fe = fnError(e);
      error = fe ? fe.message : `Failed to connect: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`;
    } finally {
      loading = false;
      if (mode === 'pin') pin = '';
      // Never re-insert a rejected password into the DOM (the eye toggle could reveal it).
      if (error) pass = '';
      if (!disposed && body.isConnected) render();
    }
  }

  body.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t || t.hasAttribute('disabled')) return;
    if (t.dataset.mode) {
      if (loading) return;
      mode = t.dataset.mode as Mode;
      error = null;
      render();
    } else if (t.dataset.digit) {
      if (pin.length < 8) setPin(pin + t.dataset.digit);
    } else if (t.hasAttribute('data-back')) {
      if (pin) setPin(pin.slice(0, -1));
    } else if (t.hasAttribute('data-submit')) {
      if (pin.length >= 4) void verify({ pin }, 'Staff', 'Incorrect PIN. Please try again.');
    } else if (t.hasAttribute('data-cancel')) {
      cancel();
    } else if (t.hasAttribute('data-eye')) {
      obscure = !obscure;
      render('[name=pass]');
    }
  });

  // Long-press backspace clears the PIN.
  let hold = 0;
  const release = () => {
    if (hold) clearTimeout(hold);
    hold = 0;
  };
  body.addEventListener('pointerdown', (e) => {
    if (!(e.target as HTMLElement).closest('[data-back]')) return;
    release();
    hold = window.setTimeout(() => {
      hold = 0;
      if (!disposed) setPin('');
    }, 500);
  });
  body.addEventListener('pointerup', release);
  body.addEventListener('pointercancel', release);
  body.addEventListener('pointerleave', release, true);

  body.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'user') user = t.value;
    if (t.name === 'pass') pass = t.value;
  });

  body.addEventListener('submit', (e) => {
    e.preventDefault();
    if (loading) return;
    const credentials = readPasswordCredentials(e.target as HTMLFormElement);
    user = credentials.username;
    pass = credentials.password;
    const name = user.trim();
    if (!name || !pass) {
      error = 'Please enter both username and password.';
      render();
      return;
    }
    void verify({ username: name, password: pass }, name, 'Incorrect username or password. Please try again.');
  });

  // A hardware keyboard works the PIN pad too.
  const onKey = (e: KeyboardEvent) => {
    if (!body.isConnected) {
      root.ownerDocument.removeEventListener('keydown', onKey);
      return;
    }
    if (mode !== 'pin' || loading || e.ctrlKey || e.metaKey || e.altKey) return;
    // A focused button or field handles its own Enter and Backspace.
    if ((e.key === 'Enter' || e.key === 'Backspace') && (e.target as HTMLElement).closest?.('button, input, a, select, textarea')) return;
    if (/^[0-9]$/.test(e.key) && pin.length < 8) setPin(pin + e.key);
    else if (e.key === 'Backspace' && pin) setPin(pin.slice(0, -1));
    else if (e.key === 'Enter' && pin.length >= 4) void verify({ pin }, 'Staff', 'Incorrect PIN. Please try again.');
  };
  root.ownerDocument.addEventListener('keydown', onKey);

  render();
  return () => {
    disposed = true;
    release();
    root.ownerDocument.removeEventListener('keydown', onKey);
  };
}
