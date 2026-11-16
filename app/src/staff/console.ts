// StaffMenuDialog (lib/screens/staff_menu.dart): the staff console bottom
// sheet the menu's "Staff console" item opens. Loaded only for staff.
import './console.css';
import { cart } from '../kiosk/cart.ts';
import { callFn } from '../kiosk/firebase.ts';
import type { IconName } from '../kiosk/icons.ts';
import { snack } from '../kiosk/snackbar.ts';
import { fnError, logout } from './session.ts';
import { esc, go, icon, showDialog } from './ui.ts';

const ORANGE = '#FF9800';
const PURPLE = '#9C27B0';
const SUCCESS = '#1E7A3C';
const INFO = '#1F5FAD';
const MUTED = '#7D4D64';
const ERROR = '#B3261E';
const WARNING = '#B45309';
const PINK = '#D91566';

const consoleBtn = (act: string, ico: IconName, title: string, color: string) =>
  `<button type="button" class="scon__big" data-act="${act}" style="--c:${color}">${icon(ico, 'scon__big-icon')}<span class="scon__big-title">${title}</span></button>`;

const actionItem = (act: string, ico: IconName, title: string, sub: string, color: string) =>
  `<button type="button" class="scon__item" data-act="${act}" style="--c:${color}"><span class="scon__circle">${icon(ico)}</span><span class="scon__text"><span class="scon__title">${esc(title)}</span><span class="scon__sub">${esc(sub)}</span></span>${icon('arrow_forward_ios_rounded', 'scon__arrow')}</button>`;

/** Opens the console. `onLogout` runs after the staff session ends. */
export function openStaffConsole(onLogout: () => void): void {
  let generating = false;
  const markup = () => `<div class="scon__panel">
  <span class="scon__handle"></span>
  <h2 class="scon__head" id="scon-title" tabindex="-1" autofocus>STAFF CONTROL CONSOLE</h2>
  <div class="scon__row">${consoleBtn('kds', 'outdoor_grill_rounded', 'LIVE ORDERS', ORANGE)}${consoleBtn('dashboard', 'dashboard_rounded', 'DASHBOARD', PURPLE)}</div>
  ${actionItem('walkin', 'point_of_sale_rounded', 'WALK-IN ORDER', 'Take a walk-in order', SUCCESS)}
  ${
    generating
      ? actionItem('report', 'hourglass_empty_rounded', 'GENERATING SUMMARY...', 'Sending report...', MUTED)
      : actionItem('report', 'telegram_rounded', 'TELEGRAM DAILY SUMMARY', "Send today's sales metrics to Telegram", INFO)
  }
  ${actionItem('logout', 'logout_rounded', 'LOGOUT STAFF PORTAL', 'Exit staff mode and clear active POS state', ERROR)}
</div>`;

  const d = showDialog(markup(), 'scon');
  d.setAttribute('aria-labelledby', 'scon-title');
  const render = () => { d.innerHTML = markup(); };

  async function sendReport() {
    generating = true;
    render();
    try {
      const data = await callFn<{ success?: boolean; message?: string }>('triggerManualReport', {}, 30);
      if (!d.isConnected) return;
      if (data.success === true) {
        d.close();
        snack('SALES REPORT SENT TO TELEGRAM!', { color: SUCCESS });
      } else {
        generating = false;
        render();
        snack(`ERROR: ${data.message ?? 'No message'}`, { color: WARNING });
      }
    } catch (e) {
      if (!d.isConnected) return;
      generating = false;
      render();
      const fe = fnError(e);
      snack(`CRASH: ${fe ? fe.message : String(e).split('\n')[0]}`, { color: ERROR });
    }
  }

  d.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'kds') go('/staff/kds');
    else if (act === 'dashboard') go('/staff/dashboard');
    else if (act === 'walkin') d.close();
    else if (act === 'report') {
      if (!generating) void sendReport();
    } else if (act === 'logout') {
      d.close();
      void logout();
      cart.clear();
      onLogout();
      snack('STAFF LOGGED OUT', { color: PINK });
    }
  });
}
