// The kitchen display's data rules: the order feed and the board's pure logic.

export interface KdsItem {
  name?: string;
  variant?: string | null;
  quantity?: number;
  qty?: number;
}

/** One order in the getActiveOrders callable's shape (`timestamp` an ISO string). */
export interface KdsOrder {
  id?: string;
  orderNumber?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  lat?: number | null;
  lng?: number | null;
  type?: string;
  entryType?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  status?: string;
  timestamp?: string;
  items?: KdsItem[];
  total?: number;
  [key: string]: unknown;
}

export const KDS_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const KDS_LIMIT = 200;

/** Mirror doc → callable-shaped order (`timestamp` as an ISO string). */
export function kdsOrderFromDoc(id: string, data: Record<string, unknown>, tsToDate: (ts: unknown) => Date | null): KdsOrder {
  const { ts, ...rest } = data;
  const out: KdsOrder = { ...rest };
  out.id ??= id;
  if (typeof out.timestamp !== 'string') {
    const date = tsToDate(ts);
    if (date) out.timestamp = date.toISOString();
  }
  return out;
}

const keyOf = (o: KdsOrder) => String(o.id ?? o.orderNumber);

/** Live orders win; callable-only orders stay until the mirror has them. Newest first. */
export function mergeKdsOrders(live: KdsOrder[], polled: KdsOrder[]): KdsOrder[] {
  const byId = new Map<string, KdsOrder>();
  for (const o of polled) byId.set(keyOf(o), o);
  for (const o of live) byId.set(keyOf(o), o);
  return [...byId.values()].sort((a, b) => {
    const x = String(b.timestamp ?? '');
    const y = String(a.timestamp ?? '');
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

export const isClosedKdsStatus = (status: unknown): boolean => status === 'Completed' || status === 'Cancelled';

export type TypeFilter = 'ALL' | 'Delivery' | 'Pickup' | 'Walk-In';

export function filterOrders(list: KdsOrder[], typeFilter: TypeFilter, query: string): KdsOrder[] {
  let res = list;
  if (typeFilter !== 'ALL') {
    res = res.filter((o) => {
      const type = (o.type ?? '').toLowerCase();
      if (typeFilter === 'Delivery') return type.includes('delivery');
      if (typeFilter === 'Pickup') return type.includes('pickup');
      return type.includes('walk-in') || (o.entryType ?? '').toLowerCase().includes('staff');
    });
  }
  const q = query.trim().toLowerCase();
  if (q) {
    res = res.filter((o) => {
      const items = (o.items ?? []).map((i) => (i.name ?? '').toLowerCase()).join(' ');
      return [o.orderNumber, o.customerName, o.customerPhone, o.customerAddress].some((f) => (f ?? '').toLowerCase().includes(q)) || items.includes(q);
    });
  }
  return res;
}

/** Whole minutes from `ts` to `now`, or null when `ts` does not parse. */
export function minutesSince(ts: string, now: number): number | null {
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : Math.trunc((now - t) / 60000);
}

export function formatElapsed(ts: string, now: number): string {
  const m = minutesSince(ts, now);
  if (m === null) return '';
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.trunc(m / 60)}h ${m % 60}m ago`;
}

export function elapsedColor(ts: string, now: number): string {
  const m = minutesSince(ts, now);
  if (m !== null && m >= 15) return '#B3261E';
  if (m !== null && m >= 8) return '#B45309';
  return 'var(--pink-ink)';
}

/** Pending for ten minutes or more. */
export const isDelayed = (o: KdsOrder, now: number): boolean => (o.status ?? 'Pending') === 'Pending' && (minutesSince(o.timestamp ?? '', now) ?? 0) >= 10;

export const qtyOf = (i: KdsItem): number => Math.trunc(Number(i.quantity ?? i.qty ?? 1));

/** Dart's toString for a JSON number: 263 → "263", 2.5 → "2.5". */
export const numText = (v: unknown): string => (typeof v === 'number' ? String(v) : String(v ?? 0));

export const mapsDirectionsUrl = (lat: number, lng: number): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

/** The rider dispatch note `_copyRiderDispatchNote` puts on the clipboard. */
export function dispatchNote(o: KdsOrder): string {
  const num = o.orderNumber ?? o.id;
  const phone = (o.customerPhone ?? '').trim();
  const addr = (o.customerAddress ?? '').trim();
  const total = numText(o.total ?? 0);
  const method = o.paymentMethod ?? 'Cash';
  const paid = (o.paymentStatus ?? '').toUpperCase() === 'PAID';
  const items = (o.items ?? []).map((i) => `  • ${i.quantity ?? i.qty ?? 1}x ${i.name}${i.variant ? ` (${i.variant})` : ''}`).join('\n');
  const maps = o.lat != null && o.lng != null ? mapsDirectionsUrl(o.lat, o.lng) : '';
  return [
    `🛵 *LUNA BITES & DELIGHTS — #${num}*`,
    `👤 Customer: ${o.customerName ?? 'Customer'}`,
    ...(phone ? [`📞 Phone: ${phone}`] : []),
    ...(addr ? [`📍 Address: ${addr}`] : []),
    ...(maps ? [`🗺 Navigation: ${maps}`] : []),
    '',
    '🛒 *Items:*',
    items,
    '',
    `💰 Food Total: ₱${total} (${paid ? `PAID (${method})` : `COLLECT ₱${total}`})`,
    '🚚 Delivery fee: Confirmed by rider upon delivery',
  ].join('\n');
}
