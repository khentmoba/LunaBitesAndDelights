import { FieldValue } from 'firebase-admin/firestore';
import { itemKey, isCountableOrder, ChannelBucket } from '../util';

/**
 * Per-day sales summary stored at `dailyStats/{YYYY-MM-DD}`.
 * The order trigger keeps it current with increments; the lifetime report
 * sums these instead of reading every order ever placed.
 */
export interface DayStats {
  date: string;
  revenue: number;
  orders: number;
  itemsSold: number;
  channel: { walkIn: ChannelBucket; delivery: ChannelBucket; pickup: ChannelBucket };
  entryType: { kiosk: ChannelBucket; staff: ChannelBucket };
  paymentMethod: { cash: ChannelBucket; gcash: ChannelBucket };
  items: { [key: string]: { name: string; variant: string; qty: number; revenue: number } };
}

/** Where one countable order lands in its day's summary. */
export interface Contribution {
  date: string;
  amount: number;
  itemsSold: number;
  channel: keyof DayStats['channel'];
  entryType: keyof DayStats['entryType'];
  paymentMethod: keyof DayStats['paymentMethod'];
  items: DayStats['items'];
}

/** Firestore map keys may not be empty and `/` reads badly in the console. */
export const statsItemKey = (name: string, variant: string): string =>
  itemKey(name, variant).replace(/\//g, '∕') || 'Unknown';

const bucket = (): ChannelBucket => ({ revenue: 0, count: 0 });

export function emptyDay(date: string): DayStats {
  return {
    date,
    revenue: 0,
    orders: 0,
    itemsSold: 0,
    channel: { walkIn: bucket(), delivery: bucket(), pickup: bucket() },
    entryType: { kiosk: bucket(), staff: bucket() },
    paymentMethod: { cash: bucket(), gcash: bucket() },
    items: {},
  };
}

/** Same counting rules the lifetime report has always used. */
export function contributionOf(data: Record<string, any> | undefined): Contribution | null {
  if (!data || !isCountableOrder(data)) return null;
  const items: Contribution['items'] = {};
  let itemsSold = 0;
  for (const item of data.items || []) {
    const name = item.name || 'Unknown';
    const variant = item.variant || '';
    const qty = item.quantity || 1;
    itemsSold += qty;
    const key = statsItemKey(name, variant);
    const slot = items[key] || (items[key] = { name, variant, qty: 0, revenue: 0 });
    slot.qty += qty;
    slot.revenue += (item.price || 0) * qty;
  }
  const type = data.type || 'Pickup';
  return {
    date: data.dateLabel || 'unknown',
    amount: data.totalAmount || 0,
    itemsSold,
    channel: type === 'Walk-In' ? 'walkIn' : type === 'Delivery' ? 'delivery' : 'pickup',
    entryType: data.entryType === 'Staff' ? 'staff' : 'kiosk',
    paymentMethod: String(data.paymentMethod || 'Cash').toLowerCase() === 'gcash' ? 'gcash' : 'cash',
    items,
  };
}

/** Adds (sign = 1) or removes (sign = -1) one order from an in-memory day. */
export function applyToDay(day: DayStats, c: Contribution, sign: 1 | -1): void {
  day.revenue += sign * c.amount;
  day.orders += sign;
  day.itemsSold += sign * c.itemsSold;
  for (const b of [day.channel[c.channel], day.entryType[c.entryType], day.paymentMethod[c.paymentMethod]]) {
    b.revenue += sign * c.amount;
    b.count += sign;
  }
  for (const [key, it] of Object.entries(c.items)) {
    const slot = day.items[key] || (day.items[key] = { name: it.name, variant: it.variant, qty: 0, revenue: 0 });
    slot.qty += sign * it.qty;
    slot.revenue += sign * it.revenue;
  }
}

/** Recomputes day summaries from order documents (legacy path + backfill). */
export function daysFromOrders(orders: Iterable<Record<string, any>>): Map<string, DayStats> {
  const days = new Map<string, DayStats>();
  for (const data of orders) {
    const c = contributionOf(data);
    if (!c) continue;
    let day = days.get(c.date);
    if (!day) days.set(c.date, (day = emptyDay(c.date)));
    applyToDay(day, c, 1);
  }
  return days;
}

const sameContribution = (a: Contribution | null, b: Contribution | null) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Per-day changes that move the summaries from an order's `before` state to
 * its `after` state. Empty when nothing countable changed (Pending →
 * Preparing, telegramSent, ...), so most order writes touch no stats.
 */
export function dayDeltas(
  before: Record<string, any> | undefined,
  after: Record<string, any> | undefined
): Map<string, DayStats> {
  const deltas = new Map<string, DayStats>();
  const b = contributionOf(before);
  const a = contributionOf(after);
  if (sameContribution(a, b)) return deltas;
  for (const [c, sign] of [[b, -1], [a, 1]] as const) {
    if (!c) continue;
    let day = deltas.get(c.date);
    if (!day) deltas.set(c.date, (day = emptyDay(c.date)));
    applyToDay(day, c, sign);
  }
  return deltas;
}

/** Firestore merge-set payload that adds a delta day to `dailyStats/{date}`. */
export function incrementPayload(d: DayStats): Record<string, any> {
  const inc = (n: number) => FieldValue.increment(n);
  const incGroup = (g: Record<string, ChannelBucket>) =>
    Object.fromEntries(
      Object.entries(g)
        .filter(([, x]) => x.revenue !== 0 || x.count !== 0)
        .map(([k, x]) => [k, { revenue: inc(x.revenue), count: inc(x.count) }])
    );
  const items = Object.fromEntries(
    Object.entries(d.items)
      .filter(([, it]) => it.qty !== 0 || it.revenue !== 0)
      .map(([k, it]) => [k, { name: it.name, variant: it.variant, qty: inc(it.qty), revenue: inc(it.revenue) }])
  );
  return {
    date: d.date,
    revenue: inc(d.revenue),
    orders: inc(d.orders),
    itemsSold: inc(d.itemsSold),
    channel: incGroup(d.channel),
    entryType: incGroup(d.entryType),
    paymentMethod: incGroup(d.paymentMethod),
    items,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const readBucket = (v: any): ChannelBucket => ({ revenue: num(v?.revenue), count: num(v?.count) });

/** Normalises a stored `dailyStats` document (missing fields read as 0). */
export function dayFromDoc(id: string, d: Record<string, any>): DayStats {
  const day = emptyDay(typeof d.date === 'string' ? d.date : id);
  day.revenue = num(d.revenue);
  day.orders = num(d.orders);
  day.itemsSold = num(d.itemsSold);
  for (const k of ['walkIn', 'delivery', 'pickup'] as const) day.channel[k] = readBucket(d.channel?.[k]);
  for (const k of ['kiosk', 'staff'] as const) day.entryType[k] = readBucket(d.entryType?.[k]);
  for (const k of ['cash', 'gcash'] as const) day.paymentMethod[k] = readBucket(d.paymentMethod?.[k]);
  for (const [k, it] of Object.entries<any>(d.items || {})) {
    day.items[k] = { name: String(it?.name ?? k), variant: String(it?.variant ?? ''), qty: num(it?.qty), revenue: num(it?.revenue) };
  }
  return day;
}

/** The getLifetimeSalesReport response body, built from day summaries. */
export function lifetimeReportFromDays(
  days: Iterable<DayStats>,
  dateRange: { start: string; end: string; isAllTime: boolean }
) {
  let totalRevenue = 0;
  let orderCount = 0;
  let totalItemsSold = 0;
  const total = emptyDay('');
  const dailySeries: { date: string; revenue: number; orders: number }[] = [];

  for (const day of days) {
    if (day.orders <= 0) continue;
    totalRevenue += day.revenue;
    orderCount += day.orders;
    totalItemsSold += day.itemsSold;
    dailySeries.push({ date: day.date, revenue: day.revenue, orders: day.orders });
    for (const g of ['channel', 'entryType', 'paymentMethod'] as const) {
      for (const [k, b] of Object.entries<ChannelBucket>(day[g])) {
        const t = (total[g] as Record<string, ChannelBucket>)[k];
        t.revenue += b.revenue;
        t.count += b.count;
      }
    }
    for (const [k, it] of Object.entries(day.items)) {
      const slot = total.items[k] || (total.items[k] = { name: it.name, variant: it.variant, qty: 0, revenue: 0 });
      slot.qty += it.qty;
      slot.revenue += it.revenue;
    }
  }

  const topItems = Object.values(total.items)
    .filter((it) => it.qty > 0)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 20)
    .map((it, index) => ({
      rank: index + 1,
      name: itemKey(it.name, it.variant),
      quantity: it.qty,
      revenue: it.revenue,
    }));

  dailySeries.sort((a, b) => a.date.localeCompare(b.date));

  return {
    success: true,
    dateRange,
    summary: {
      totalRevenue,
      orderCount,
      averageOrderValue: orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0,
      totalItemsSold,
    },
    breakdown: {
      channel: total.channel,
      entryType: total.entryType,
      paymentMethod: total.paymentMethod,
    },
    topItems,
    dailySeries,
  };
}
