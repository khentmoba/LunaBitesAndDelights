// The two report pages: AnalyticsPage (lib/screens/analytics_page.dart) and
// LifetimeAnalyticsPage (lib/screens/lifetime_analytics_page.dart), both in
// ReportScaffold (lib/widgets/report/report_widgets.dart).
import { callFn } from '../kiosk/firebase.ts';
import type { IconName } from '../kiosk/icons.ts';
import { staffErrorMessage, type Staff } from './session.ts';
import { fmt, formatMonthAxisLabel, label, PRESETS, type Preset, phtToday, presetRange, shortFmt } from './report-data.ts';
import { cameFromApp, esc, go, icon, int, num, showDialog } from './ui.ts';

type Data = Record<string, unknown>;
const rec = (v: unknown): Data => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Data) : {});
const list = (v: unknown): Data[] => (Array.isArray(v) ? v.map(rec) : []);

interface Report {
  title: string;
  refreshTip: string;
  fetch: () => Promise<Data>;
  failMsg: string;
  loadMsg: string;
  /** Markup above the scrolling body that stays put (the lifetime date filter). */
  top?: () => string;
  body: (d: Data) => string;
  onClick?: (t: HTMLElement, reload: () => void) => void;
}

function mountReport(root: HTMLElement, getStaff: () => Staff | null, r: Report): () => void {
  let loading = false;
  let error: string | null = null;
  let data: Data = {};
  let disposed = false;

  root.innerHTML = `<div class="rep">
<header class="rbar">
  <button type="button" class="rbar__ib rbar__back" data-act="back" aria-label="Back" title="Back">${icon('arrow_back')}</button>
  <h1 class="rbar__title"><span data-fit-title>${esc(r.title)}</span></h1>
  <button type="button" class="rbar__ib" data-act="refresh" aria-label="${esc(r.refreshTip)}" title="${esc(r.refreshTip)}">${icon('refresh_rounded')}</button>
</header>
<div class="rep__main" data-main></div>
</div>`;
  const main = root.querySelector<HTMLElement>('[data-main]')!;
  const refresh = root.querySelector<HTMLButtonElement>('[data-act="refresh"]')!;
  const titleText = root.querySelector<HTMLElement>('[data-fit-title]')!;

  /** NavigationToolbar: centre the title in the bar, keep it clear of the
   * 56px leading slot and the 48px of actions (16px spacing each side), and
   * FittedBox it down when it is wider than that. */
  function fitTitle() {
    const bar = titleText.closest<HTMLElement>('.rbar')!;
    const h1 = titleText.parentElement!;
    const W = bar.clientWidth;
    const avail = Math.max(0, W - 56 - 48 - 32);
    titleText.style.transform = '';
    const w = titleText.getBoundingClientRect().width;
    const s = w > avail && w > 0 ? avail / w : 1;
    if (s < 1) titleText.style.transform = `scale(${s})`;
    const rw = w * s;
    h1.style.left = `${Math.min(Math.max((W - rw) / 2, 72), W - 64 - rw)}px`;
  }

  async function load() {
    if (!getStaff()) return;
    loading = true;
    error = null;
    render();
    try {
      const d = await r.fetch();
      if (disposed) return;
      if (d.success === true) data = d;
      else error = typeof d.message === 'string' ? d.message : r.failMsg;
    } catch (e) {
      if (disposed) return;
      error = staffErrorMessage(e, r.loadMsg, 'Error connecting to server. Please try again.');
    }
    loading = false;
    if (!disposed) render();
  }

  function render() {
    refresh.disabled = loading;
    main.innerHTML = loading
      ? '<div class="rep__center"><span class="rspin" role="progressbar" aria-label="Loading"></span></div>'
      : error !== null
        ? `<div class="rep__center rerr" role="alert">${icon('error_outline_rounded', 'rerr__icon')}<p class="rerr__msg">${esc(error)}</p><button type="button" class="rerr__btn" data-act="retry">Retry</button></div>`
        : `${r.top?.() ?? ''}<div class="rep__scroll">${r.body(data)}</div>`;
  }

  const onRootClick = (ev: Event) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || t.hasAttribute('disabled')) return;
    const act = t.dataset.act;
    if (act === 'back') {
      if (cameFromApp() && history.length > 1) history.back();
      else go('/staff/dashboard');
    } else if (act === 'refresh' || act === 'retry') void load();
    else r.onClick?.(t, () => void load());
  };
  root.addEventListener('click', onRootClick);

  addEventListener('resize', fitTitle);
  render();
  fitTitle();
  void document.fonts.ready.then(fitTitle);
  void load();
  return () => {
    disposed = true;
    removeEventListener('resize', fitTitle);
    root.removeEventListener('click', onRootClick);
  };
}

function metric(title: string, value: string, ico: IconName, color: string, compact = false): string {
  return `<div class="metric${compact ? ' metric--compact' : ''}" style="--c:${color}"><span class="metric__icon">${icon(ico)}</span><div class="metric__text"><p class="metric__title">${esc(title)}</p><p class="metric__value">${esc(value)}</p></div></div>`;
}

const ORANGE = 'var(--orange)';
const PURPLE = 'var(--purple)';
const INFO = 'var(--info)';
const SUCCESS = 'var(--success)';
const WARNING = 'var(--warning)';

/* ---------------- Sales dashboard (today) ---------------- */

export function mountAnalytics(root: HTMLElement, getStaff: () => Staff | null): () => void {
  return mountReport(root, getStaff, {
    title: 'SALES DASHBOARD',
    refreshTip: 'Refresh Metrics',
    fetch: () => callFn<Data>('getSalesAnalytics'),
    failMsg: 'Failed to load analytics.',
    loadMsg: 'Could not load analytics',
    body: (d) => {
      const breakdown = rec(d.breakdown);
      const rev = (k: string) => int(rec(breakdown[k]).revenue);
      const walkIn = rev('walkIn');
      const pickup = rev('pickup');
      const delivery = rev('delivery');
      const max = Math.max(walkIn, pickup, delivery);
      const bar = (label: string, v: number, color: string) => {
        const h = 15 + (max > 0 ? v / max : 0.05) * 135;
        return `<div class="cbar"><span class="cbar__value">₱${v}</span><span class="cbar__bar" style="--c:${color};height:${h}px"></span><span class="cbar__label">${label}</span></div>`;
      };
      const items = list(d.topItems);
      return `<div class="ana">
<div class="ana__head">
  <div><p class="rlabel">TODAY'S REVENUE METRICS</p><p class="ana__date">${esc(d.dateLabel ?? 'Date loading...')}</p></div>
  <span class="synced">${icon('check_circle_rounded')}LIVE SYNCED</span>
</div>
<div class="ana__metrics">
  ${metric('TOTAL REVENUE', `₱${num(d.totalRevenue)}`, 'monetization_on_rounded', SUCCESS)}
  ${metric('TICKET COUNT', String(num(d.orderCount)), 'receipt_long_rounded', INFO)}
  ${metric('AVG TICKET', `₱${num(d.averageOrderValue)}`, 'analytics_rounded', PURPLE)}
</div>
<div class="ana__split">
  <section class="rcard rcard--flat ana__chart">
    <h2 class="rcard__title">CHANNEL SALES SPLIT</h2><hr class="kdivider">
    <div class="cbars">${bar('Walk-In', walkIn, ORANGE)}${bar('Pickup', pickup, INFO)}${bar('Delivery', delivery, PURPLE)}</div>
  </section>
  <section class="rcard rcard--flat ana__top">
    <h2 class="rcard__title">TOP MENU ITEMS</h2><hr class="kdivider">
    ${
      items.length
        ? items
            .map(
              (it, i) =>
                `<div class="titem"><span class="titem__rank">${i + 1}</span><span class="titem__name">${esc(it.name)}</span><span class="titem__count">${esc(num(it.count))} sold</span></div>`,
            )
            .join('')
        : '<p class="rnone">No item sales recorded today</p>'
    }
  </section>
</div>
</div>`;
    },
  });
}

/* ---------------- Lifetime report ---------------- */

export function mountLifetime(root: HTMLElement, getStaff: () => Staff | null): () => void {
  let preset: Preset = 'allTime';
  let custom: { start: string; end: string } | null = null;

  const miniStat = (lbl: string, value: string, sub: string, color: string) =>
    `<div class="mini"><span class="mini__dot" style="background:${color}"></span><div class="mini__text"><p class="mini__label">${lbl}</p><p class="mini__sub">${esc(sub)}</p></div><p class="mini__value">${esc(value)}</p></div>`;

  const share = (a: string, av: number, b: string, bv: number) => {
    const total = av + bv;
    return total > 0 ? `<hr class="kdivider"><p class="mini__share">${a}: ${((av / total) * 100).toFixed(1)}%  ·  ${b}: ${((bv / total) * 100).toFixed(1)}%</p>` : '';
  };

  function pickCustom(reload: () => void) {
    const todayDate = phtToday();
    const today = label(todayDate);
    const start = custom?.start ?? label(new Date(todayDate.getTime() - 30 * 86400_000));
    const end = custom?.end ?? today;
    const d = showDialog(
      `<form method="dialog" class="rrange">
  <h2 class="rrange__title">Select range</h2>
  <label class="rrange__field"><span>Start date</span><input type="date" name="start" min="2020-01-01" max="${today}" value="${start}" required></label>
  <label class="rrange__field"><span>End date</span><input type="date" name="end" min="2020-01-01" max="${today}" value="${end}" required></label>
  <div class="rrange__actions"><button type="button" class="rrange__btn" data-cancel>Cancel</button><button class="rrange__btn" value="ok">Save</button></div>
</form>`,
      'sdialog rrange__dialog',
    );
    const form = d.querySelector('form')!;
    d.querySelector('[data-cancel]')!.addEventListener('click', () => d.close());
    form.addEventListener('submit', (ev) => {
      const s = (form.elements.namedItem('start') as HTMLInputElement).value;
      const e = (form.elements.namedItem('end') as HTMLInputElement).value;
      if (!s || !e) return;
      ev.preventDefault();
      custom = s <= e ? { start: s, end: e } : { start: e, end: s };
      preset = 'custom';
      d.close();
      reload();
    });
  }

  return mountReport(root, getStaff, {
    title: 'LIFETIME SALES REPORT',
    refreshTip: 'Refresh',
    fetch: () => callFn<Data>('getLifetimeSalesReport', presetRange(preset, custom) ?? {}),
    failMsg: 'Failed to load report.',
    loadMsg: 'Could not load report',
    top: () =>
      `<nav class="lfilter" aria-label="Date range"><div class="lfilter__row">${PRESETS.map(([id, text]) => `<button type="button" class="lchip${id === preset ? ' lchip--on' : ''}" data-act="preset" data-preset="${id}" aria-pressed="${id === preset}">${text}</button>`).join('')}</div></nav>`,
    onClick: (t, reload) => {
      if (t.dataset.act !== 'preset') return;
      const p = t.dataset.preset as Preset;
      if (p === 'custom') return pickCustom(reload);
      preset = p;
      reload();
    },
    body: (d) => {
      const summary = rec(d.summary);
      const range = rec(d.dateRange);
      const rangeLabel = range.isAllTime === true ? 'LIFETIME (ALL TIME)' : `${range.start ?? '?'}  →  ${range.end ?? '?'}`;
      const breakdown = rec(d.breakdown);
      const bucket = (group: string, k: string) => rec(rec(breakdown[group])[k]);
      const rev = (g: string, k: string) => int(bucket(g, k).revenue);
      const cnt = (g: string, k: string) => int(bucket(g, k).count);

      // Revenue over time, grouped by month.
      const series = list(d.dailySeries);
      const monthly = new Map<string, { rev: number; orders: number }>();
      for (const day of series) {
        const date = String(day.date ?? '');
        if (!/^\d{4}-\d{2}/.test(date)) continue;
        const m = monthly.get(date.slice(0, 7)) ?? { rev: 0, orders: 0 };
        m.rev += int(day.revenue);
        m.orders += int(day.orders);
        monthly.set(date.slice(0, 7), m);
      }
      const months = [...monthly.keys()].sort();
      const maxMonth = Math.max(0, ...[...monthly.values()].map((m) => m.rev));
      const chart = !series.length
        ? '<section class="rcard rcard--pad28"><p class="rnone rnone--flat">No sales data for this period</p></section>'
        : !months.length
          ? ''
          : `<section class="rcard">
  <div class="rcard__head"><h2 class="rcard__title rcard__title--14">REVENUE OVER TIME</h2><span class="rcard__aside">(Monthly)</span></div><hr class="kdivider">
  <div class="mchart">${months
    .map((k) => {
      const m = monthly.get(k)!;
      const h = 20 + (maxMonth > 0 ? m.rev / maxMonth : 0.05) * 100;
      return `<div class="mcol"><span class="mcol__rev">₱${shortFmt(m.rev)}</span><span class="mcol__orders">${m.orders} orders</span><span class="mcol__bar" style="height:${h}px"></span><span class="mcol__label">${formatMonthAxisLabel(k)}</span></div>`;
    })
    .join('')}</div>
</section>`;

      const chMax = Math.max(rev('channel', 'walkIn'), rev('channel', 'delivery'), rev('channel', 'pickup'));
      const split = (lbl: string, k: string, color: string) => {
        const r = rev('channel', k);
        const frac = chMax > 0 ? r / chMax : 0;
        return `<div class="sbar"><div class="sbar__row"><span class="sbar__label">${lbl}</span><span class="sbar__meta">₱${fmt(r)}  ·  ${cnt('channel', k)} orders</span></div><span class="sbar__track" style="--c:${color}"><span style="width:${frac * 100}%"></span></span></div>`;
      };
      const channel = `<section class="rcard"><h2 class="rcard__title rcard__title--14">CHANNEL SALES SPLIT</h2><hr class="kdivider"><div class="rcard__gap20"></div>${split('Walk-In', 'walkIn', ORANGE)}${split('Pickup', 'pickup', INFO)}${split('Delivery', 'delivery', PURPLE)}</section>`;
      const entry = `<section class="rcard"><h2 class="rcard__title rcard__title--14">ORDER ENTRY</h2><hr class="kdivider"><div class="rcard__gap20"></div>${miniStat('Kiosk', `₱${fmt(rev('entryType', 'kiosk'))}`, `${cnt('entryType', 'kiosk')} orders`, INFO)}${miniStat('Staff', `₱${fmt(rev('entryType', 'staff'))}`, `${cnt('entryType', 'staff')} orders`, ORANGE)}${share('Kiosk', rev('entryType', 'kiosk'), 'Staff', rev('entryType', 'staff'))}</section>`;
      const payment = `<section class="rcard"><h2 class="rcard__title rcard__title--14">PAYMENT METHOD</h2><hr class="kdivider"><div class="rcard__gap20"></div>${miniStat('Cash', `₱${fmt(rev('paymentMethod', 'cash'))}`, `${cnt('paymentMethod', 'cash')} orders`, SUCCESS)}${miniStat('GCash', `₱${fmt(rev('paymentMethod', 'gcash'))}`, `${cnt('paymentMethod', 'gcash')} orders`, INFO)}${share('Cash', rev('paymentMethod', 'cash'), 'GCash', rev('paymentMethod', 'gcash'))}</section>`;

      const items = list(d.topItems);
      const best = `<section class="rcard"><h2 class="rcard__title rcard__title--14">BEST SELLERS</h2><p class="rcard__sub">Top items by quantity sold</p><hr class="kdivider"><div class="rcard__gap16"></div>${
        items.length
          ? items
              .map(
                (it, i) =>
                  `<div class="bitem"><span class="bitem__rank${i < 3 ? ` bitem__rank--${i + 1}` : ''}">#${i + 1}</span><div class="bitem__text"><p class="bitem__name">${esc(it.name ?? 'Unknown')}</p><p class="bitem__rev">₱${fmt(int(it.revenue))} total</p></div><span class="bitem__qty">${int(it.quantity)} sold</span></div>`,
              )
              .join('')
          : '<p class="rnone rnone--32">No item sales recorded</p>'
      }</section>`;

      return `<div class="life">
<div class="life__head">
  <div><p class="rlabel rlabel--14">SALES OVERVIEW</p><p class="life__range">${esc(rangeLabel)}</p></div>
  <span class="life__count">${int(summary.orderCount)} orders</span>
</div>
<div class="life__metrics">
  ${metric('TOTAL REVENUE', `₱${fmt(int(summary.totalRevenue))}`, 'monetization_on_rounded', SUCCESS, true)}
  ${metric('TOTAL ORDERS', fmt(int(summary.orderCount)), 'receipt_long_rounded', INFO, true)}
  ${metric('AVG ORDER', `₱${fmt(int(summary.averageOrderValue))}`, 'analytics_rounded', PURPLE, true)}
  ${metric('ITEMS SOLD', fmt(int(summary.totalItemsSold)), 'shopping_bag_rounded', WARNING, true)}
</div>
${chart}
<div class="life__pair life__pair--a">${channel}${entry}</div>
<div class="life__pair life__pair--b">${payment}${best}</div>
</div>`;
    },
  });
}
