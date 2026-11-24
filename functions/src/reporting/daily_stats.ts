import { FieldValue, Firestore, Query, QueryDocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { itemKey, isCountableOrder, finiteNumber, ChannelBucket } from '../util';

export const STATS_META_DOC = 'stats_meta/dailyStats';
export const BACKFILL_CACHE_TTL_MS = 5 * 60 * 1000;
export const FALLBACK_PAGE_SIZE = 1000;
export const MAX_FALLBACK_PAGES = 20;
let backfilledCachedUntil = 0;

/**
 * Bounded cursor-paginated scan of one day's orders, used only by the legacy
 * fallback while dailyStats is not backfilled. Caps both memory and Firestore
 * reads so a busy day (or a repeated staff analytics call) cannot grow without limit.
 */
export async function scanOrdersForDate(
  db: Firestore,
  dateLabel: string,
): Promise<QueryDocumentSnapshot[]> {
  const base: Query = db.collection('orders').where('dateLabel', '==', dateLabel);
  const docs: QueryDocumentSnapshot[] = [];
  let lastDoc: QueryDocumentSnapshot | null = null;
  for (let page = 0; page < MAX_FALLBACK_PAGES; page++) {
    const pageQuery: Query = lastDoc
      ? base.startAfter(lastDoc).limit(FALLBACK_PAGE_SIZE)
      : base.limit(FALLBACK_PAGE_SIZE);
    const snap: QuerySnapshot = await pageQuery.get();
    docs.push(...snap.docs);
    if (snap.size < FALLBACK_PAGE_SIZE) return docs;
    lastDoc = snap.docs[snap.docs.length - 1];
  }
  throw new HttpsError(
    'failed-precondition',
    'Order history exceeds fallback scan limit. Run backfill-derived-views to enable dailyStats.',
  );
}

/**
 * Caches `stats_meta/dailyStats.backfilledAt` once true for a bounded TTL
 * to skip redundant reads on warm instances while still observing resets.
 */
export async function isDailyStatsBackfilled(
  db: Pick<Firestore, 'doc'>,
  nowMs = Date.now(),
): Promise<boolean> {
  if (nowMs < backfilledCachedUntil) return true;
  const snap = await db.doc(STATS_META_DOC).get();
  if (snap.exists && snap.get('backfilledAt')) {
    backfilledCachedUntil = nowMs + BACKFILL_CACHE_TTL_MS;
    return true;
  }
  backfilledCachedUntil = 0;
  return false;
}

/** Resets the in-memory backfill cache (used by tests). */
export function resetBackfillCache(): void {
  backfilledCachedUntil = 0;
}

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

const VALID_DATE_LABEL = /^\d{4}-\d{2}-\d{2}$/;

/** Normalizes a Firestore-safe YYYY-MM-DD date label; malformed values fall back to 'unknown'. */
export function safeDateLabel(raw: unknown): string {
  return typeof raw === 'string' && VALID_DATE_LABEL.test(raw) ? raw : 'unknown';
}

function getOrCreateItemSlot(
  items: DayStats['items'],
  key: string,
  name: string,
  variant: string,
): DayStats['items'][string] {
  if (Object.prototype.hasOwnProperty.call(items, key)) {
    return items[key];
  }
  const slot = { name, variant, qty: 0, revenue: 0 };
  Object.defineProperty(items, key, { value: slot, enumerable: true, writable: true, configurable: true });
  return slot;
}

/** Same counting rules the lifetime report has always used. */
export function contributionOf(data: Record<string, any> | undefined): Contribution | null {
  if (!data || !isCountableOrder(data)) return null;
  const items: Contribution['items'] = {};
  let itemsSold = 0;
  const rawItems = Array.isArray(data.items) ? data.items : [];
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof item.name === 'string' && item.name.length > 0 ? item.name : 'Unknown';
    const variant = typeof item.variant === 'string' ? item.variant : '';
    const rawQty = finiteNumber(item.quantity || item.qty);
    const qty = rawQty > 0 ? rawQty : 1;
    itemsSold += qty;
    const key = statsItemKey(name, variant);
    const slot = getOrCreateItemSlot(items, key, name, variant);
    slot.qty += qty;
    slot.revenue += finiteNumber(item.price) * qty;
  }
  const type = data.type || 'Pickup';
  return {
    date: safeDateLabel(data.dateLabel),
    amount: finiteNumber(data.totalAmount),
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
    const slot = getOrCreateItemSlot(day.items, key, it.name, it.variant);
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

/** The getSalesAnalytics response body for a single day, built from its dailyStats summary. */
export function salesAnalyticsFromDay(dateLabel: string, day: DayStats) {
  const itemCounts: Record<string, number> = Object.create(null);
  for (const it of Object.values(day.items)) {
    if (it.qty <= 0) continue;
    const key = itemKey(it.name || 'Unknown', it.variant);
    itemCounts[key] = (itemCounts[key] || 0) + it.qty;
  }
  const topItems = Object.entries(itemCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    success: true,
    dateLabel,
    totalRevenue: day.revenue,
    totalItemsSold: day.itemsSold,
    orderCount: day.orders,
    averageOrderValue: day.orders > 0 ? Math.round(day.revenue / day.orders) : 0,
    breakdown: {
      walkIn: day.channel.walkIn,
      delivery: day.channel.delivery,
      pickup: day.channel.pickup,
    },
    topItems,
  };
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
      const slot = getOrCreateItemSlot(total.items, k, it.name, it.variant);
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
