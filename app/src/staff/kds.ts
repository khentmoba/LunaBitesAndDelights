// The live kitchen board. Orders come
// from the kds_orders mirror in real time, with one getActiveOrders call on
// open; if the listener fails the board polls every 10 s instead.
import { callFn, firebaseDb } from '../kiosk/firebase.ts';
import type { IconName } from '../kiosk/icons.ts';
import { playOrderChime, setSound, soundEnabled } from './chime.ts';
import {
  KDS_LIMIT,
  KDS_LOOKBACK_MS,
  dispatchNote,
  elapsedColor,
  filterOrders,
  formatElapsed,
  isClosedKdsStatus,
  isDelayed,
  kdsOrderFromDoc,
  mapsDirectionsUrl,
  mergeKdsOrders,
  numText,
  qtyOf,
  type KdsOrder,
  type TypeFilter,
} from './kds-data.ts';
import { fnError, isAuthCode, isAuthErrorText, logout, type Staff } from './session.ts';
import { ERROR, INK, INK_SOFT, PLATE, SUCCESS, cameFromApp, esc, go, icon, showDialog, staffSnack } from './ui.ts';

const POLL_MS = 10_000;
const CANCEL_REASONS = ['Item Out of Stock', 'Customer Requested Cancellation', 'Duplicate / Test Order', 'Store Closing / Capacity'];

type Column = 'Pending' | 'Preparing' | 'Ready' | 'Completed';
const COLUMNS: { status: Column; title: string; tab: string; icon: IconName; cls: string; tone: string; empty: string; emptyIcon: IconName }[] = [
  { status: 'Pending', title: '1. PENDING QUEUE', tab: 'PENDING', icon: 'hourglass_top_outlined', cls: 'pending', tone: 'plate', empty: 'No orders in queue.', emptyIcon: 'hourglass_empty_outlined' },
  { status: 'Preparing', title: '2. PREPARING NOW', tab: 'COOKING', icon: 'outdoor_grill_outlined', cls: 'preparing', tone: 'card', empty: 'Grill & fryer are clear.', emptyIcon: 'outdoor_grill_outlined' },
  { status: 'Ready', title: '3. READY FOR PICKUP / RIDER', tab: 'READY', icon: 'done_all_rounded', cls: 'ready', tone: 'green', empty: 'No orders ready for pickup.', emptyIcon: 'check_circle_outline_rounded' },
  { status: 'Completed', title: '4. DONE / HISTORY', tab: 'DONE', icon: 'history_rounded', cls: 'done', tone: 'rule', empty: 'No completed orders yet.', emptyIcon: 'check_circle_outline_rounded' },
];

export function mountKds(root: HTMLElement, getStaff: () => Staff | null): () => void {
  let polled: KdsOrder[] = [];
  let live: KdsOrder[] | null = null;
  let orders: KdsOrder[] = [];
  let isLive = false;
  let connecting = false;
  let loading = false;
  let error: string | null = null;
  let typeFilter: TypeFilter = 'ALL';
  let query = '';
  let showCompleted = false;
  let now = Date.now();
  let knownPending = new Set<string>();
  let initialDone = false;
  let tab = 0;
  const checked = new Set<string>();
  const updating = new Set<string>();
  let unsub: (() => void) | null = null;
  let pollTimer = 0;
  let disposed = false;

  const back = cameFromApp();
  root.innerHTML = `
<div class="kds">
  <header class="kbar" data-bar></header>
  <div class="kctl" data-ctl></div>
  <div data-banner></div>
  <main class="kboard" data-board></main>
</div>`;
  const bar = root.querySelector<HTMLElement>('[data-bar]')!;
  const ctl = root.querySelector<HTMLElement>('[data-ctl]')!;
  const banner = root.querySelector<HTMLElement>('[data-banner]')!;
  const board = root.querySelector<HTMLElement>('[data-board]')!;
  const wideMq = matchMedia('(min-width: 960px)');

  // ---- data ----

  function publish() {
    const all = mergeKdsOrders(live ?? [], polled);
    const visible = showCompleted ? all : all.filter((o) => !isClosedKdsStatus(o.status));
    checkNewOrders(visible);
    orders = visible;
    loading = false;
    renderAll();
  }

  function checkNewOrders(fresh: KdsOrder[]) {
    const ids = new Set(fresh.filter((o) => o.status === 'Pending').map((o) => String(o.id ?? o.orderNumber)));
    if (initialDone) {
      const arrivals = [...ids].filter((id) => !knownPending.has(id)).length;
      if (arrivals) {
        playOrderChime();
        staffSnack(`New order received (${arrivals} incoming)`, PLATE);
      }
    }
    knownPending = ids;
    initialDone = true;
  }

  async function fetchActive(silent = false) {
    if (!getStaff()) return;
    if (!silent) loading = true;
    error = null;
    renderBar();
    renderBanner();
    try {
      const data = await callFn<{ success?: boolean; orders?: KdsOrder[]; message?: string }>('getActiveOrders', { includeCompleted: true });
      if (disposed) return;
      if (data.success === true) {
        polled = data.orders ?? [];
        publish();
      } else {
        error = data.message ?? 'Failed to load active orders.';
        loading = false;
        renderAll();
      }
    } catch (e) {
      if (disposed) return;
      const fe = fnError(e);
      error = fe
        ? isAuthCode(fe.code)
          ? `Staff session expired or unauthorized (${fe.code}). Please sign in again.`
          : `Could not load live orders: ${fe.message}`
        : 'Connection error while loading live orders. Tap RETRY to sync.';
      loading = false;
      renderAll();
    }
  }

  function fallBackToPolling() {
    unsub?.();
    unsub = null;
    connecting = false;
    isLive = false;
    if (disposed) return;
    renderBar();
    pollTimer ||= window.setInterval(() => {
      if (getStaff()) void fetchActive(true);
    }, POLL_MS);
  }

  async function startFeeds() {
    void fetchActive();
    connecting = true;
    try {
      const [db, fs] = await Promise.all([firebaseDb(), import('firebase/firestore')]);
      if (disposed) return;
      const q = fs.query(
        fs.collection(db, 'kds_orders'),
        fs.where('ts', '>=', fs.Timestamp.fromMillis(Date.now() - KDS_LOOKBACK_MS)),
        fs.orderBy('ts', 'desc'),
        fs.limit(KDS_LIMIT),
      );
      const toDate = (ts: unknown) => (ts instanceof fs.Timestamp ? ts.toDate() : null);
      unsub = fs.onSnapshot(
        q,
        (snap) => {
          if (disposed) return;
          clearInterval(pollTimer);
          pollTimer = 0;
          isLive = true;
          live = snap.docs.map((d) => kdsOrderFromDoc(d.id, d.data(), toDate));
          publish();
        },
        () => fallBackToPolling(),
      );
    } catch {
      fallBackToPolling();
    }
  }

  async function updateStatus(orderId: string, status: string, cancellationReason?: string) {
    if (updating.has(orderId)) return;
    updating.add(orderId);
    loading = true;
    renderAll();
    try {
      const data = await callFn<{ success?: boolean; message?: string }>('updateOrderStatus', {
        orderId,
        status,
        ...(cancellationReason ? { cancellationReason } : {}),
      });
      if (disposed) return;
      if (data.success === true) {
        if (isLive) loading = false;
        else await fetchActive(true);
        staffSnack(`Order updated: ${status}`, SUCCESS);
      } else {
        loading = false;
        staffSnack(`Error: ${data.message}`, ERROR);
      }
    } catch {
      if (disposed) return;
      loading = false;
      staffSnack('Failed to update status. Connection error.', ERROR);
    } finally {
      updating.delete(orderId);
      if (!disposed) renderAll();
    }
  }

  function toggleSound() {
    setSound(!soundEnabled);
    if (soundEnabled) {
      playOrderChime();
      staffSnack('Audio Alert Enabled (Chime tested)', SUCCESS);
    } else {
      staffSnack('Audio Alert Muted', INK_SOFT);
    }
    renderBar();
  }

  // signOut must finish before the page unloads, or the Auth row stays in
  // IndexedDB and customer pages still treat this browser as staff.
  function exit() {
    void logout().then(() => go('/'));
  }

  // ---- rendering ----

  function feedState() {
    if (isLive) return { color: SUCCESS, short: 'Live', long: 'Live', label: 'Orders update live' };
    if (connecting) return { color: INK_SOFT, short: 'Connecting', long: 'Connecting…', label: 'Connecting to live orders' };
    return { color: '#B45309', short: '10s', long: 'Auto-sync every 10s', label: 'Live updates unavailable, refreshing every 10 seconds' };
  }

  function renderBar() {
    const staff = getStaff();
    const feed = feedState();
    const admin = staff?.isAdmin ?? false;
    const spin = '<span class="kbar__spin" aria-hidden="true"></span>';
    const sync = `<button type="button" class="kbar__ib kbar__ib--sync" data-act="sync" title="Sync Orders Now" aria-label="Sync Orders Now"${loading ? ' disabled' : ''}>${loading ? spin : icon('sync_rounded')}</button>`;
    bar.innerHTML = `
  ${back ? `<button type="button" class="kbar__back" data-act="back" aria-label="Back" title="Back">${icon('arrow_back')}</button>` : ''}
  <div class="kbar__title${back ? '' : ' kbar__title--solo'}">
    <span class="kbar__logo"><img src="/kiosk/images/luna_logo.webp" alt="" width="24" height="28" decoding="async"></span>
    <div class="kbar__text">
      <h1 class="kbar__name"><span class="kbar__long">LUNA LIVE OPERATIONS</span><span class="kbar__short">LIVE KDS</span></h1>
      <div class="kbar__status">
        <span class="kbar__dot" style="background:${feed.color}"></span>
        <span class="kbar__feed mb" role="status" aria-label="${esc(feed.label)}"><span class="kbar__long">Purok 5 Kiosk · ${esc(feed.long)}</span><span class="kbar__short">${esc(feed.short)}</span></span>
        <span class="kbar__role${admin ? ' kbar__role--admin' : ''}">${admin ? 'ADMIN' : 'STAFF'}</span>
      </div>
    </div>
  </div>
  <div class="kbar__actions kbar__actions--wide">
    <button type="button" class="kbar__ib${soundEnabled ? '' : ' is-off'}" data-act="sound" title="${soundEnabled ? 'Audio Alerts: ON (Tap to Mute)' : 'Audio Alerts: MUTED (Tap to Enable)'}" aria-label="${soundEnabled ? 'Mute audio alerts' : 'Enable audio alerts'}" aria-pressed="${soundEnabled}">${icon(soundEnabled ? 'volume_up_rounded' : 'volume_off_rounded')}</button>
    ${sync}
    <a class="kbar__pos" href="/kiosk/menu">${icon('point_of_sale_outlined')}<span>POS WALK-IN</span></a>
    <a class="kbar__ib" href="/staff/dashboard" title="Sales Analytics &amp; Admin" aria-label="Sales Analytics &amp; Admin">${icon('bar_chart_outlined')}</a>
    <button type="button" class="kbar__ib kbar__ib--exit" data-act="exit" title="Exit Staff Portal" aria-label="Exit Staff Portal">${icon('logout_rounded')}</button>
  </div>
  <div class="kbar__actions kbar__actions--narrow">
    ${sync}
    <a class="kbar__pos" href="/kiosk/menu">${icon('point_of_sale_outlined')}<span>POS</span></a>
    <button type="button" class="kbar__ib kbar__ib--more" data-act="menu" title="Staff Menu" aria-label="Staff Menu" aria-haspopup="menu">${icon('more_vert')}</button>
  </div>`;
  }

  function chip(value: TypeFilter, ico?: IconName) {
    const on = typeFilter === value;
    return `<button type="button" class="kchip" data-filter="${value}" aria-pressed="${on}">${ico ? icon(ico) : ''}<span>${value.toUpperCase()}</span></button>`;
  }

  function renderControls() {
    ctl.innerHTML = `
  <div class="kctl__chips">${chip('ALL')}${chip('Delivery', 'motorcycle_outlined')}${chip('Pickup', 'storefront_outlined')}${chip('Walk-In', 'shopping_bag_outlined')}</div>
  <label class="ksearch">${icon('search_rounded')}<span class="sr-only">Search orders</span><input type="search" data-search placeholder="Search orders..." value="${esc(query)}" autocomplete="off" enterkeyhint="search"><button type="button" class="ksearch__clear" data-act="clear" aria-label="Clear search"${query ? '' : ' hidden'}>${icon('clear_rounded')}</button></label>
  <button type="button" class="khist" data-act="history" aria-pressed="${showCompleted}">${icon(showCompleted ? 'check_box_outlined' : 'check_box_outline_blank_outlined')}<span>HISTORY</span></button>`;
  }

  function syncControls() {
    for (const b of ctl.querySelectorAll<HTMLElement>('[data-filter]')) b.setAttribute('aria-pressed', String(b.dataset.filter === typeFilter));
    const h = ctl.querySelector<HTMLElement>('[data-act=history]')!;
    h.setAttribute('aria-pressed', String(showCompleted));
    h.querySelector('.icon')!.outerHTML = icon(showCompleted ? 'check_box_outlined' : 'check_box_outline_blank_outlined');
    ctl.querySelector<HTMLElement>('[data-act=clear]')!.hidden = !query;
  }

  function renderBanner() {
    if (error === null) {
      banner.innerHTML = '';
      return;
    }
    const auth = isAuthErrorText(error);
    banner.innerHTML = `
  <div class="kerr" role="alert">${icon('warning_amber_rounded')}<span class="kerr__text">${esc(error)}</span>
    ${auth ? '<button type="button" class="kerr__btn kerr__btn--auth" data-act="signin">SIGN IN</button>' : ''}
    <button type="button" class="kerr__btn" data-act="retry">RETRY</button>
  </div>`;
  }

  function card(o: KdsOrder): string {
    const id = String(o.id ?? '');
    const num = String(o.orderNumber ?? id);
    const name = (o.customerName ?? 'Customer').trim();
    const phone = (o.customerPhone ?? '').trim();
    const addr = (o.customerAddress ?? '').trim();
    const type = o.type ?? 'Walk-In';
    const paid = (o.paymentStatus ?? 'NOT PAID').toUpperCase() === 'PAID';
    const method = o.paymentMethod ?? 'Cash';
    const status = o.status ?? 'Pending';
    const ts = o.timestamp ?? '';
    const total = numText(o.total ?? 0);
    const lower = type.toLowerCase();
    const delivery = lower.includes('delivery');
    const pickup = lower.includes('pickup');
    const delayed = isDelayed(o, now);
    const elapsed = formatElapsed(ts, now);
    const color = delayed ? INK : elapsedColor(ts, now);
    const busy = updating.has(id);
    const lat = typeof o.lat === 'number' ? o.lat : null;
    const lng = typeof o.lng === 'number' ? o.lng : null;

    const items = (o.items ?? [])
      .map((it, idx) => {
        const key = `${id}_${idx}`;
        const on = checked.has(key);
        return `<button type="button" class="kitem${on ? ' is-done' : ''}" data-check="${esc(key)}" aria-pressed="${on}">
        <span class="kitem__box">${on ? icon('check') : ''}</span>
        <span class="kitem__qty">${qtyOf(it)}x</span>
        <span class="kitem__text"><span class="kitem__name">${esc(it.name ?? 'Item')}</span>${it.variant ? `<span class="kitem__variant">${esc(it.variant)}</span>` : ''}</span>
      </button>`;
      })
      .join('');

    let action: string;
    const next = status === 'Pending' ? ['START PREPARING', 'Preparing', 'plate', 'outdoor_grill_outlined'] : status === 'Preparing' ? ['MARK AS READY', 'Ready', 'green', 'done_all_rounded'] : status === 'Ready' ? ['COMPLETE & DISPATCH', 'Completed', 'paper', 'task_alt_rounded'] : null;
    if (next) {
      const [label, to, tone, ico] = next as [string, string, string, IconName];
      action = `<button type="button" class="kact kact--${tone}" data-status="${to}" data-id="${esc(id)}"${busy ? ' disabled' : ''}>${icon(busy ? 'hourglass_top_rounded' : ico)}<span>${busy ? 'UPDATING...' : esc(label)}</span></button>`;
    } else {
      action = `<p class="kact-done">ORDER ${esc(status)}</p>`;
    }

    return `
<article class="kcard${delayed ? ' is-delayed' : ''}">
  <div class="kcard__top">
    <div class="kcard__ids">
      <span class="kcard__num">#${esc(num)}</span>
      <button type="button" class="kcard__ib" data-ticket="${esc(id)}" title="Kitchen Slip Ticket" aria-label="Kitchen slip ticket for #${esc(num)}">${icon('receipt_long_outlined')}</button>
      ${delivery ? `<button type="button" class="kcard__ib kcard__ib--copy" data-copy="${esc(id)}" title="Copy Delivery Dispatch Note" aria-label="Copy dispatch note for #${esc(num)}">${icon('copy_rounded')}</button>` : ''}
    </div>
    <span class="kcard__age${delayed ? ' is-delayed' : ''}" style="color:${color}">${icon(delayed ? 'warning_amber_rounded' : 'access_time_rounded')}<span>${esc(delayed ? `DELAYED (${elapsed})` : elapsed)}</span></span>
  </div>
  <div class="kcard__pills">
    <span class="kpill kpill--${delivery ? 'delivery' : pickup ? 'pickup' : 'walkin'}">${icon(delivery ? 'motorcycle_outlined' : pickup ? 'storefront_outlined' : 'shopping_bag_outlined')}<span>${esc(type.toUpperCase())}</span></span>
    <span class="kpill kpill--${paid ? 'paid' : 'collect'}">${esc(paid ? `PAID (${method})` : `COLLECT ₱${total}`)}</span>
  </div>
  <div class="kcard__who">
    <span class="kcard__name">${esc(name)}</span>
    ${phone ? `<a class="kcard__phone" href="tel:${esc(phone)}">${icon('phone_outlined')}<span>${esc(phone)}</span></a>` : ''}
  </div>
  ${
    delivery && addr
      ? `<div class="kcard__addr">${icon('place_outlined')}<span class="kcard__addrtext">${esc(addr)}</span>${
          lat !== null && lng !== null ? `<a class="kcard__map" href="${esc(mapsDirectionsUrl(lat, lng))}" target="_blank" rel="noopener">MAP</a>` : ''
        }</div>`
      : ''
  }
  <hr class="kcard__rule">
  <div class="kcard__items">${items}</div>
  <div class="kcard__total">
    <span><span class="kcard__tlabel">${delivery ? 'FOOD TOTAL: ' : 'TOTAL: '}</span><span class="kcard__tval">₱${esc(total)}</span></span>
    ${status === 'Pending' ? `<button type="button" class="kcard__cancel" data-cancel="${esc(id)}"${busy ? ' disabled' : ''}>Cancel</button>` : ''}
  </div>
  ${action}
</article>`;
  }

  function list(col: (typeof COLUMNS)[number], rows: KdsOrder[]): string {
    if (!rows.length) return `<div class="kempty">${icon(col.emptyIcon)}<p>${col.empty}</p></div>`;
    return `<div class="klist">${rows.map(card).join('')}</div>`;
  }

  function buckets() {
    const filtered = filterOrders(orders, typeFilter, query);
    return {
      Pending: filtered.filter((o) => o.status === 'Pending'),
      Preparing: filtered.filter((o) => o.status === 'Preparing'),
      Ready: filtered.filter((o) => o.status === 'Ready'),
      Completed: filtered.filter((o) => isClosedKdsStatus(o.status)),
    } satisfies Record<Column, KdsOrder[]>;
  }

  const badge = (n: number, tone: string) => `<span class="kbadge kbadge--${tone}">${n}</span>`;

  let layout: 'wide' | 'tabs' | null = null;
  let layoutCols = 0;

  function renderBoard() {
    const b = buckets();
    if (wideMq.matches) {
      const cols = COLUMNS.filter((c) => c.status !== 'Completed' || showCompleted);
      if (layout !== 'wide' || layoutCols !== cols.length) {
        layout = 'wide';
        layoutCols = cols.length;
        board.className = 'kboard kboard--wide';
        board.innerHTML = cols
          .map(
            (c) => `<section class="kcol" aria-labelledby="kcol-${c.cls}">
  <h2 class="kcol__head kcol__head--${c.cls}" id="kcol-${c.cls}">${icon(c.icon)}<span class="kcol__title">${c.title}</span><span class="kcol__count" data-count="${c.status}"></span></h2>
  <div class="kcol__body" data-list="${c.status}"></div>
</section>`,
          )
          .join('');
      }
      for (const c of cols) {
        board.querySelector(`[data-count="${c.status}"]`)!.textContent = String(b[c.status].length);
        board.querySelector(`[data-list="${c.status}"]`)!.innerHTML = list(c, b[c.status]);
      }
      return;
    }
    if (layout !== 'tabs') {
      layout = 'tabs';
      board.className = 'kboard kboard--tabs';
      board.innerHTML = `
<div class="ktabs" role="tablist">${COLUMNS.map((c, i) => `<button type="button" class="ktab" role="tab" id="ktab-${i}" aria-controls="kpane-${i}" data-tab="${i}"><span class="ktab__in"><span>${c.tab}</span><span data-tabcount="${i}"></span></span></button>`).join('')}</div>
<div class="kpanes" data-panes>${COLUMNS.map((c, i) => `<div class="kpane" role="tabpanel" id="kpane-${i}" aria-labelledby="ktab-${i}" data-list="${c.status}"></div>`).join('')}</div>`;
      const panes = board.querySelector<HTMLElement>('[data-panes]')!;
      panes.scrollLeft = tab * panes.clientWidth;
      panes.addEventListener('scroll', () => {
        const i = Math.round(panes.scrollLeft / Math.max(1, panes.clientWidth));
        if (i !== tab) {
          tab = i;
          syncTabs();
        }
      }, { passive: true });
    }
    COLUMNS.forEach((c, i) => {
      board.querySelector(`[data-tabcount="${i}"]`)!.innerHTML = badge(b[c.status].length, c.tone);
      board.querySelector(`[data-list="${c.status}"]`)!.innerHTML = list(c, b[c.status]);
    });
    syncTabs();
  }

  function syncTabs() {
    board.querySelectorAll<HTMLElement>('[data-tab]').forEach((t) => {
      const on = Number(t.dataset.tab) === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
  }

  function renderAll() {
    if (disposed) return;
    renderBar();
    syncControls();
    renderBanner();
    renderBoard();
  }

  // ---- dialogs and menus ----

  const byId = (id: string) => orders.find((o) => String(o.id ?? '') === id);

  function ticket(o: KdsOrder) {
    const num = o.orderNumber ?? o.id;
    const phone = (o.customerPhone ?? '').trim();
    const addr = (o.customerAddress ?? '').trim();
    const rule = '<p class="kslip__rule">--------------------------------</p>';
    const items = (o.items ?? [])
      .map((i) => `<div class="kslip__item"><span class="kslip__qty">${qtyOf(i)}x </span><span><span class="kslip__name">${esc(i.name ?? '')}</span>${i.variant ? `<span class="kslip__variant">${esc(i.variant)}</span>` : ''}</span></div>`)
      .join('');
    const d = showDialog(`
<h2 class="sdialog__title">${icon('receipt_long_rounded')}<span>KITCHEN TICKET</span></h2>
<div class="sdialog__content"><div class="kslip">
  <div class="kslip__head">
    <p class="kslip__brand">LUNA BITES &amp; DELIGHTS</p>
    <p class="kslip__sub mb">Purok 5, Magallanes · KITCHEN SLIP</p>
    <p class="kslip__num">#${esc(num)}</p>
    <p class="kslip__type mb">${esc((o.type ?? 'Walk-In').toUpperCase())}</p>
  </div>
  ${rule}
  <p class="kslip__cust mb">Customer: ${esc(o.customerName ?? 'Customer')}</p>
  ${phone ? `<p class="kslip__phone mb">Phone: ${esc(phone)}</p>` : ''}
  ${addr ? `<p class="kslip__addr mb">Address: ${esc(addr)}</p>` : ''}
  ${rule}
  <div class="kslip__items">${items}</div>
  ${rule}
  <div class="kslip__total"><span>TOTAL:</span><span class="kslip__amt">₱${esc(numText(o.total ?? 0))} (${esc((o.paymentStatus ?? 'NOT PAID').toUpperCase())})</span></div>
  <p class="kslip__pay mb">Payment: ${esc(o.paymentMethod ?? 'Cash')}</p>
</div></div>
<div class="sdialog__actions">
  <button type="button" class="sdialog__text" data-close>CLOSE</button>
  <button type="button" class="sdialog__go" data-print>${icon('print_rounded')}<span>PRINT SLIP</span></button>
</div>`);
    d.querySelector('[data-close]')!.addEventListener('click', () => d.close());
    d.querySelector('[data-print]')!.addEventListener('click', () => {
      d.close();
      window.print();
      staffSnack('Print dialog opened', SUCCESS);
    });
  }

  function confirmCancel(id: string, num: string) {
    let reason = CANCEL_REASONS[0];
    const d = showDialog(`
<h2 class="sdialog__title">CANCEL ORDER #${esc(num)}?</h2>
<div class="sdialog__content">
  <p class="kcancel__lead mb" id="kcancel-lead">Select cancellation reason:</p>
  <div class="kcancel__list" role="radiogroup" aria-labelledby="kcancel-lead">${CANCEL_REASONS.map((r) => `<button type="button" class="kreason" role="radio" data-reason="${esc(r)}" aria-checked="${r === reason}"><span class="kreason__box"></span><span>${esc(r)}</span></button>`).join('')}</div>
</div>
<div class="sdialog__actions">
  <button type="button" class="sdialog__text" data-close>BACK</button>
  <button type="button" class="sdialog__go sdialog__go--danger" data-confirm>CONFIRM CANCEL</button>
</div>`);
    d.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!t) return;
      if (t.dataset.reason) {
        reason = t.dataset.reason;
        d.querySelectorAll<HTMLElement>('[data-reason]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.reason === reason)));
      } else if (t.hasAttribute('data-close')) d.close();
      else if (t.hasAttribute('data-confirm')) {
        d.close();
        void updateStatus(id, 'Cancelled', reason);
      }
    });
  }

  function openMenu(anchor: HTMLElement) {
    const r = anchor.getBoundingClientRect();
    const d = showDialog(
      `<div class="kmenu__list" role="menu" style="top:${Math.round(r.top + 4)}px;right:${Math.round(innerWidth - r.right + 4)}px">
  <button type="button" class="kmenu__item" role="menuitem" data-m="sound">${icon(soundEnabled ? 'volume_up_rounded' : 'volume_off_rounded')}<span>${soundEnabled ? 'Mute Chime' : 'Enable Chime'}</span></button>
  <button type="button" class="kmenu__item" role="menuitem" data-m="analytics">${icon('bar_chart_outlined')}<span>Sales &amp; Admin</span></button>
  <button type="button" class="kmenu__item kmenu__item--exit" role="menuitem" data-m="logout">${icon('logout_rounded')}<span>Exit Staff Portal</span></button>
</div>`,
      'kmenu',
    );
    d.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-m]');
      if (!t) return;
      d.close();
      if (t.dataset.m === 'sound') toggleSound();
      else if (t.dataset.m === 'analytics') go('/staff/dashboard');
      else exit();
    });
  }

  // ---- events ----

  const onRootClick = (e: Event) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t || t.hasAttribute('disabled')) return;
    const act = t.dataset.act;
    if (act === 'back') history.back();
    else if (act === 'sync') void fetchActive();
    else if (act === 'sound') toggleSound();
    else if (act === 'exit') exit();
    else if (act === 'menu') openMenu(t);
    else if (act === 'history') {
      showCompleted = !showCompleted;
      publish();
    } else if (act === 'clear') {
      query = '';
      ctl.querySelector<HTMLInputElement>('[data-search]')!.value = '';
      syncControls();
      renderBoard();
    } else if (act === 'retry') void fetchActive();
    else if (act === 'signin') void logout();
    else if (t.dataset.filter) {
      typeFilter = t.dataset.filter as TypeFilter;
      syncControls();
      renderBoard();
    } else if (t.dataset.tab) {
      tab = Number(t.dataset.tab);
      if (tab === 3 && !showCompleted) {
        showCompleted = true;
        publish();
      } else {
        syncTabs();
      }
      const panes = board.querySelector<HTMLElement>('[data-panes]')!;
      panes.scrollTo({ left: tab * panes.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    } else if (t.dataset.check) {
      const k = t.dataset.check;
      if (checked.has(k)) checked.delete(k);
      else checked.add(k);
      renderBoard();
    } else if (t.dataset.status && t.dataset.id !== undefined) void updateStatus(t.dataset.id, t.dataset.status);
    else if (t.dataset.cancel !== undefined) {
      const o = byId(t.dataset.cancel);
      confirmCancel(t.dataset.cancel, String(o?.orderNumber ?? t.dataset.cancel));
    } else if (t.dataset.ticket !== undefined) {
      const o = byId(t.dataset.ticket);
      if (o) ticket(o);
    } else if (t.dataset.copy !== undefined) {
      const o = byId(t.dataset.copy);
      if (o) {
        if (!navigator.clipboard?.writeText) {
          staffSnack('Clipboard unavailable', ERROR);
        } else {
          void navigator.clipboard.writeText(dispatchNote(o)).then(
            () => staffSnack('Delivery dispatch note copied to clipboard', SUCCESS),
            () => staffSnack('Could not copy dispatch note', ERROR),
          );
        }
      }
    }
  };
  root.addEventListener('click', onRootClick);

  ctl.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.matches('[data-search]')) return;
    query = t.value;
    syncControls();
    renderBoard();
  });

  const onLayout = () => {
    layout = null;
    renderBoard();
  };
  wideMq.addEventListener('change', onLayout);
  const clock = window.setInterval(() => {
    now = Date.now();
    renderBoard();
  }, 30_000);

  renderControls();
  renderAll();
  void startFeeds();

  return () => {
    disposed = true;
    unsub?.();
    clearInterval(pollTimer);
    clearInterval(clock);
    wideMq.removeEventListener('change', onLayout);
    root.removeEventListener('click', onRootClick);
  };
}
