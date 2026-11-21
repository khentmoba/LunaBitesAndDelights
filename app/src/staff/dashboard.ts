// Staff dashboard: today's numbers, the
// kitchen and walk-in shortcuts, quick actions and the latest orders.
import { cart } from '../kiosk/cart.ts';
import { $ } from '../kiosk/dom.ts';
import { callFn } from '../kiosk/firebase.ts';
import type { IconName } from '../kiosk/icons.ts';
import { localStamp, phtDateLabel } from '../kiosk/order.ts';
import { snack } from '../kiosk/snackbar.ts';
import { isAuthErrorText, logout, staffErrorMessage, type Staff } from './session.ts';
import { diagonals, esc, go, icon, int, showDialog } from './ui.ts';

interface Tile {
  orderNumber: string;
  customerName: string;
  type: string;
  isWalkIn: boolean;
  total: number;
  time: string;
  status: string;
}

export function tileFrom(o: Record<string, unknown>): Tile {
  const ts = new Date(String(o.timestamp ?? ''));
  const type = String(o.type ?? 'Pickup');
  return {
    orderNumber: String(o.orderNumber ?? o.id ?? ''),
    customerName: String(o.customerName ?? 'Customer'),
    type,
    isWalkIn: o.entryType === 'Staff' || String(o.type ?? '').toLowerCase().includes('walk-in'),
    total: int(o.total),
    time: Number.isNaN(ts.getTime()) ? '' : localStamp(ts),
    status: String(o.status ?? 'Pending'),
  };
}

const ACTIONS: { icon: IconName; title: string; sub: string; color: string; act: string }[] = [
  { icon: 'bar_chart_rounded', title: 'Sales Report', sub: 'View detailed analytics', color: 'var(--info)', act: 'analytics' },
  { icon: 'receipt_long_rounded', title: 'Order History', sub: 'Recent orders', color: 'var(--purple)', act: 'history' },
  { icon: 'menu_book_rounded', title: 'Menu Manager', sub: 'View menu items', color: 'var(--success)', act: 'walkin' },
  { icon: 'tv_rounded', title: 'KDS Display', sub: 'Kitchen display system', color: 'var(--warning)', act: 'kds' },
];

export function orderTile(o: Tile): string {
  const type = o.isWalkIn ? 'Walk-In' : o.type;
  const ico: IconName = o.isWalkIn ? 'receipt_long_outlined' : type === 'Pickup' ? 'storefront_outlined' : 'delivery_dining_outlined';
  const color = o.isWalkIn ? 'var(--success)' : type === 'Pickup' ? 'var(--warning)' : 'var(--info)';
  return `<article class="otile" style="--c:${color}">
  <span class="otile__icon">${icon(ico)}</span>
  <div class="otile__main">
    <div class="otile__head"><span class="otile__num">${esc(o.orderNumber)}</span><span class="otile__type">${esc(type)}</span></div>
    <p class="otile__meta">${esc(o.customerName)}  ·  ${esc(o.time)}</p>
  </div>
  <span class="otile__total">₱${o.total}</span>
</article>`;
}

export function mountDashboard(root: HTMLElement, getStaff: () => Staff | null): () => void {
  let loading = false;
  let error: string | null = null;
  let stats: { revenue: number; count: number; avg: number; items: number } = { revenue: 0, count: 0, avg: 0, items: 0 };
  let orders: Tile[] = [];
  let allOrders: Tile[] | null = null;
  let disposed = false;
  let fetchSeq = 0;

  root.innerHTML = '<main class="dash" data-dash></main>';
  const el = $('[data-dash]', root);

  async function fetchData() {
    if (!getStaff()) return;
    const seq = ++fetchSeq;
    loading = true;
    error = null;
    allOrders = null;
    render();
    try {
      const [analytics, res] = await Promise.all([
        callFn<Record<string, unknown>>('getSalesAnalytics'),
        callFn<{ success?: boolean; orders?: Record<string, unknown>[] }>('getActiveOrders', { includeCompleted: true, limit: 10 }),
      ]);
      if (disposed || seq !== fetchSeq) return;
      const raw = res.orders ?? [];
      let items = int(analytics.totalItemsSold);
      if (items === 0 && raw.length) {
        const today = phtDateLabel(new Date());
        for (const o of raw) {
          if (o.status === 'Cancelled') continue;
          if (String(o.paymentMethod ?? '').toLowerCase() === 'gcash' && o.paymentStatus !== 'PAID') continue;
          const ts = new Date(String(o.timestamp ?? ''));
          if (!Number.isNaN(ts.getTime()) && phtDateLabel(ts) === today) items += int(o.itemsCount);
        }
      }
      if (analytics.success === true) {
        stats = { revenue: int(analytics.totalRevenue), count: int(analytics.orderCount), avg: int(analytics.averageOrderValue), items };
      }
      if (res.success === true) orders = raw.map(tileFrom);
    } catch (e) {
      if (disposed || seq !== fetchSeq) return;
      error = staffErrorMessage(e, 'Could not load dashboard data', 'Error connecting to server. Tap RETRY to sync.');
    }
    if (seq !== fetchSeq) return;
    loading = false;
    if (!disposed) render();
  }

  function stat(label: string, value: string, ico: IconName, color: string) {
    return `<div class="wcard stat" style="--c:${color}"><span class="tint-box">${icon(ico)}</span><p class="stat__value" data-fit>${esc(value)}</p><p class="stat__label">${esc(label)}</p></div>`;
  }

  function render() {
    const staff = getStaff();
    const auth = error !== null && isAuthErrorText(error);
    const recent = orders.slice(0, 10);
    el.innerHTML = `
<header class="dhead" data-ga>
  <div class="dhead__row">
    <span class="dhead__logo"><img src="/kiosk/images/luna_logo.webp" alt="" width="30" height="36" decoding="async"></span>
    <div class="dhead__text">
      <h1 class="dhead__name">Luna Bites &amp; Delights</h1>
      <p class="dhead__hi">Welcome, ${esc(staff?.username ?? '')}!</p>
    </div>
    <button type="button" class="dhead__ib" data-act="refresh" title="Refresh Dashboard" aria-label="Refresh dashboard"${loading ? ' disabled' : ''}>${icon('refresh_rounded')}</button>
    <button type="button" class="dhead__ib dhead__ib--narrow" data-act="logout" title="Logout" aria-label="Logout">${icon('logout_rounded')}</button>
    <button type="button" class="dhead__logout" data-act="logout">${icon('logout_rounded')}<span>Logout</span></button>
  </div>
  <p class="dhead__badge">ADMIN DASHBOARD</p>
</header>
${
  error === null
    ? ''
    : `<div class="derr" role="alert">${icon('warning_amber_rounded')}<span class="derr__text">${esc(error)}</span>${auth ? '<button type="button" class="dtext" data-act="signin">SIGN IN</button>' : ''}<button type="button" class="dtext" data-act="retry">RETRY</button></div>`
}
${loading ? '<div class="dprogress" role="progressbar" aria-label="Loading dashboard"><span></span></div>' : ''}
<h2 class="dsec dsec--first">TODAY'S OVERVIEW</h2>
<div class="dgrid">
  ${stat("Today's Sales", `₱${stats.revenue}`, 'trending_up_rounded', 'var(--success)')}
  ${stat('Orders', String(stats.count), 'receipt_long_rounded', 'var(--info)')}
  ${stat('Avg order', `₱${stats.avg}`, 'analytics_rounded', 'var(--purple)')}
  ${stat('Items sold', String(stats.items), 'shopping_bag_rounded', 'var(--warning)')}
</div>
<a class="dkds" href="/staff/kds">
  <span class="dkds__icon">${icon('outdoor_grill_rounded')}</span>
  <span class="dkds__text"><span class="dkds__title">LIVE ORDERS KANBAN (KDS)</span><span class="dkds__sub">Kitchen display, audio alerts &amp; dispatch queue</span></span>
  ${icon('arrow_forward_rounded', 'dkds__arrow')}
</a>
<a class="dwalk" href="/kiosk/menu">
  <span class="dwalk__icon">${icon('storefront_rounded')}</span>
  <span class="dwalk__title">New Walk-in Order</span>
  ${icon('arrow_forward_rounded', 'dwalk__arrow')}
</a>
<h2 class="dsec">QUICK ACTIONS</h2>
<div class="dgrid">
  ${ACTIONS.map((a) => `<button type="button" class="wcard daction" data-act="${a.act}" style="--c:${a.color}"><span class="tint-box">${icon(a.icon)}</span><span class="daction__title">${a.title}</span><span class="daction__sub">${a.sub}</span></button>`).join('')}
</div>
<a class="dlife" data-ga href="/staff/lifetime">
  <span class="dlife__icon">${icon('leaderboard_rounded')}</span>
  <span class="dlife__text"><span class="dlife__title">LIFETIME SALES REPORT</span><span class="dlife__sub">Full history · Best sellers · Date filters</span></span>
  ${icon('arrow_forward_rounded', 'dlife__arrow')}
</a>
<h2 class="dsec">RECENT ORDERS</h2>
${
  recent.length
    ? recent.map(orderTile).join('')
    : `<div class="dempty">${icon('receipt_long_outlined')}<p class="dempty__title">No orders yet today</p><p class="dempty__sub">Start by placing a walk-in order!</p></div>`
}`;
    fitValues(el);
    diagonals(el);
  }

  async function showSheet() {
    if (!orders.length) {
      snack('No orders yet today.', { color: 'var(--plate)', seconds: 4 });
      return;
    }
    let list = allOrders ?? orders;
    if (allOrders === null && orders.length >= 10) {
      try {
        const res = await callFn<{ success?: boolean; orders?: Record<string, unknown>[] }>('getActiveOrders', {
          includeCompleted: true,
          limit: 50,
        });
        if (disposed) return;
        if (res.success === true && Array.isArray(res.orders)) {
          allOrders = res.orders.map(tileFrom);
          list = allOrders;
        }
      } catch {
        // Fall back to the already-loaded recent orders if the expanded fetch fails.
      }
    }
    const d = showDialog(
      `<div class="osheet__panel">
  <span class="osheet__handle"></span>
  <div class="osheet__head"><h2 class="osheet__title" id="osheet-title">All orders</h2><span class="osheet__count">${list.length} total</span></div>
  <hr class="kdivider">
  <div class="osheet__list">${list.map(orderTile).join('')}</div>
</div>`,
      'osheet',
    );
    d.setAttribute('aria-labelledby', 'osheet-title');
  }

  el.addEventListener('click', (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('button[data-act]');
    if (!t || t.hasAttribute('disabled')) return;
    const act = t.dataset.act;
    if (act === 'refresh' || act === 'retry') void fetchData();
    else if (act === 'signin') void logout();
    else if (act === 'logout') {
      cart.clear();
      void logout().then(() => go('/'));
    } else if (act === 'analytics') go('/staff/analytics');
    else if (act === 'history') void showSheet();
    else if (act === 'walkin') go('/kiosk/menu');
    else if (act === 'kds') go('/staff/kds');
  });

  let resizeRaf = 0;
  const onResize = () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      if (disposed) return;
      fitValues(el);
      diagonals(el);
    });
  };
  addEventListener('resize', onResize);
  render();
  void fetchData();
  return () => {
    disposed = true;
    cancelAnimationFrame(resizeRaf);
    removeEventListener('resize', onResize);
  };
}

/** FittedBox(scaleDown): a value wider than its card shrinks to fit. */
export function fitValues(scope: HTMLElement): void {
  const nodes = Array.from(scope.querySelectorAll<HTMLElement>('[data-fit]'));
  if (!nodes.length) return;
  for (const v of nodes) v.style.transform = '';
  const scales = nodes.map((v) => {
    const parent = v.parentElement!;
    const cs = getComputedStyle(parent);
    const box = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const w = v.scrollWidth;
    return w > box && box > 0 ? box / w : 1;
  });
  nodes.forEach((v, i) => {
    const s = scales[i] ?? 1;
    if (s < 1) v.style.transform = `scale(${s})`;
  });
}
