// Order rules and the checkout pipeline: validation, delivery details,
// formatting and placing the order. Everything above placeOrder is pure so
// Node tests can run it without a browser.
import type { CartItem } from './cart';

export type OrderType = 'Pickup' | 'Delivery' | 'Walk-In';
export type PaymentMethod = 'Cash' | 'GCash';

export const MAX_ITEMS = 50;
export const MAX_NAME_LENGTH = 100;

/** Status fields a new order may carry under firestore.rules. */
export function statusesFor(isStaff: boolean, paymentMethod: PaymentMethod) {
  if (isStaff) return { status: 'Pending', paymentStatus: 'PAID', entryType: 'Staff' } as const;
  return {
    status: 'Pending',
    paymentStatus: paymentMethod === 'GCash' ? 'AWAITING_PAYMENT' : 'NOT PAID',
    entryType: 'Kiosk',
  } as const;
}

/** A reason the rules would reject this order, or null if they accept it. */
export function rejectionFor(customerName: string, itemCount: number): string | null {
  if (customerName.length === 0) return 'Please enter a name for this order.';
  if (customerName.length > MAX_NAME_LENGTH) {
    return `Name is too long. Please keep it under ${MAX_NAME_LENGTH} characters.`;
  }
  if (itemCount > MAX_ITEMS) {
    return `An order can have up to ${MAX_ITEMS} different items. Please split it into two orders.`;
  }
  return null;
}

export function validateName(v: string, max = 100): string | null {
  if (v.trim().length === 0) return 'Name is required';
  if (v.trim().length > max) return 'Name too long';
  return null;
}

export function validatePhone(v: string): string | null {
  const p = v.trim().replace(/[\s-]/g, '');
  if (p.length === 0) return 'Phone is required';
  if (!/^(\+?63|0)9\d{9}$/.test(p)) return 'Enter a valid PH mobile number';
  return null;
}

const two = (n: number) => String(n).padStart(2, '0');

/** Wall-clock fields in Philippine time (UTC+8, no DST). */
function pht(at: Date) {
  const d = new Date(at.getTime() + 8 * 3600_000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

/** 'YYYY-MM-DD' in PHT. */
export function phtDateLabel(at = new Date()): string {
  const t = pht(at);
  return `${t.y}-${two(t.mo)}-${two(t.d)}`;
}

function randomSuffix(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(3);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  }
  return Array.from({ length: 3 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

/** 'LU-YYMMDD-HHMMSS-XXX' in PHT (3-char suffix prevents same-second collisions). */
export function orderNumberFor(at = new Date(), suffix = randomSuffix()): string {
  const t = pht(at);
  const base = `LU-${two(t.y % 100)}${two(t.mo)}${two(t.d)}-${two(t.h)}${two(t.mi)}${two(t.s)}`;
  return suffix ? `${base}-${suffix}` : base;
}

/** Device-local 'YYYY-MM-DD  HH:MM', as the receipt and Telegram show it. */
export function localStamp(at = new Date()): string {
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}  ${two(at.getHours())}:${two(at.getMinutes())}`;
}

export const STORE = { lat: 9.020509, lng: 125.517591 };
export const BASE2 = { lat: 9.121259, lng: 125.5429739 };

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const p = 0.017453292519943295;
  const a = 0.5 - Math.cos((lat2 - lat1) * p) / 2 + (Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lng2 - lng1) * p))) / 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

/** Kilometres from the nearer kitchen. */
export function deliveryDistance(lat: number, lng: number): number {
  return Math.min(haversine(STORE.lat, STORE.lng, lat, lng), haversine(BASE2.lat, BASE2.lng, lat, lng));
}

export interface OrderItem {
  name: string;
  variant: string;
  price: number;
  quantity: number;
}

export interface Order {
  orderId: string;
  items: OrderItem[];
  totalAmount: number;
  timestamp: Date;
  dateLabel: string;
  type: OrderType;
  entryType: 'Kiosk' | 'Staff';
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  lat: number | null;
  lng: number | null;
  deliveryFee: number;
  totalDistance: number;
  paymentMethod: PaymentMethod;
  paymentStatus: string;
  status: string;
}

export const orderItems = (items: readonly CartItem[]): OrderItem[] =>
  items.map((i) => ({ name: i.name, variant: i.variant, price: i.price, quantity: i.quantity }));

/** OrderModel.toJson, minus the timestamp, which the caller turns into a Firestore Timestamp. */
export function orderFields(order: Order) {
  return {
    orderId: order.orderId,
    items: order.items.map((i) => ({ ...i, total: i.price * i.quantity })),
    totalAmount: order.totalAmount,
    dateLabel: order.dateLabel,
    type: order.type,
    entryType: order.entryType,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerAddress: order.customerAddress,
    lat: order.lat,
    lng: order.lng,
    deliveryFee: order.deliveryFee,
    totalDistance: order.totalDistance,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    status: order.status,
    checkoutSessionId: null,
    paymongoPaymentId: null,
  };
}

/** The sendOrderNotification payload. */
export function notificationFor(order: Order, timeStr: string, orderDocId: string) {
  return {
    orderDocId,
    orderNumber: order.orderId,
    customerName: order.customerName,
    customerAddress: order.customerAddress,
    customerPhone: order.customerPhone,
    items: order.items,
    total: order.totalAmount,
    timeStr,
    orderType: order.type,
    deliveryFee: order.deliveryFee,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    lat: order.lat,
    lng: order.lng,
  };
}

/** Generates an alphanumeric idempotency key for safe order submission retries. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 24 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

/**
 * Places an order via the server-validated `placeOrder` callable (onOrderWritten
 * handles Telegram notification reliably). Falls back to direct Firestore write
 * + `sendOrderNotification` only if the callable is not yet deployed.
 */
export async function placeOrder(
  order: Order,
  timeStr: string,
  idempotencyKey?: string,
): Promise<{ docId: string | null; telegramSent: boolean; orderId?: string; totalAmount?: number; items?: OrderItem[]; errorCode?: string }> {
  const { firebaseDbLite, callFn } = await import('./firebase');
  try {
    const res = await callFn<{
      success?: boolean;
      docId?: string;
      orderId?: string;
      totalAmount?: number;
      items?: OrderItem[];
    }>('placeOrder', {
      orderId: order.orderId,
      items: order.items,
      type: order.type,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerAddress: order.customerAddress,
      lat: order.lat,
      lng: order.lng,
      totalDistance: order.totalDistance,
      paymentMethod: order.paymentMethod,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    if (res.success === true && typeof res.docId === 'string' && res.docId) {
      return {
        docId: res.docId,
        telegramSent: true,
        orderId: typeof res.orderId === 'string' && res.orderId ? res.orderId : order.orderId,
        totalAmount: typeof res.totalAmount === 'number' && Number.isFinite(res.totalAmount)
          ? res.totalAmount
          : order.totalAmount,
        ...(Array.isArray(res.items) && res.items.length > 0 ? { items: res.items } : {}),
      };
    }
    return { docId: null, telegramSent: false };
  } catch (e: unknown) {
    const code = typeof (e as { code?: unknown })?.code === 'string'
      ? String((e as { code?: unknown }).code).replace(/^functions\//, '')
      : '';
    if (code !== 'not-found' && code !== 'unimplemented') {
      console.error(`Error placing order ${order.orderId}`, e);
      return { docId: null, telegramSent: false, ...(code ? { errorCode: code } : {}) };
    }
  }

  let docId: string;
  try {
    const [db, fs] = await Promise.all([firebaseDbLite(), import('firebase/firestore/lite')]);
    const ref = fs.doc(fs.collection(db, 'orders'));
    await fs.setDoc(ref, { ...orderFields(order), timestamp: fs.Timestamp.fromDate(order.timestamp) });
    docId = ref.id;
  } catch (e) {
    console.error(`Error saving order ${order.orderId}`, e);
    return { docId: null, telegramSent: false };
  }
  try {
    const data = await callFn<{ success?: boolean }>('sendOrderNotification', notificationFor(order, timeStr, docId));
    return { docId, telegramSent: data.success === true, items: order.items };
  } catch (e) {
    console.error(`Telegram notification error for order ${order.orderId}`, e);
    return { docId, telegramSent: false };
  }
}
