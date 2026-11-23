// What one kiosk page hands the next. Each page is its own document, so these
// ride in sessionStorage.
import type { OrderItem, OrderType, PaymentMethod } from './order';

/** The checkout form, kept while the shopper visits the map or GCash and comes back. */
export interface CheckoutDraft {
  name: string;
  phone: string;
  address: string;
  orderType: OrderType;
  paymentMethod: PaymentMethod;
  lat: number;
  lng: number;
  pinned: boolean;
  distance: number;
  /** An order already saved for GCash, reused on retry until the form or cart changes. */
  pendingDocId: string | null;
  pendingNumber: string | null;
  /** The cart lines that order was saved with. */
  pendingCart?: string;
  /** Stable idempotency key for retrying a timed-out order submission. */
  idempotencyKey?: string;
  /** Set by the GCash page when the shopper backs out without paying. */
  gcashCancelled?: boolean;
}

/** ReceiptPage's constructor arguments. */
export interface Receipt {
  orderNumber: string;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  items: OrderItem[];
  total: number;
  timeStr: string;
  isWalkIn: boolean;
  orderType: OrderType;
  telegramSent: boolean;
}

/** GCashCheckoutPage's constructor arguments, plus the receipt to show once paid. */
export interface PendingPayment {
  orderDocId: string;
  orderId: string;
  amount: number;
  items: OrderItem[];
  customerName: string;
  customerPhone: string;
  receipt: Receipt;
}

export const DRAFT = 'luna.checkout';
export const RECEIPT = 'luna.receipt';
export const PENDING = 'luna.pending';

export function load<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the next page falls back to its empty state.
  }
}

/** sessionStorage is user-writable and survives app updates: reject bad shapes. */
export function validReceipt(value: unknown): value is Receipt {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<Receipt>;
  return typeof r.orderNumber === 'string'
    && typeof r.customerName === 'string'
    && typeof r.customerAddress === 'string'
    && typeof r.customerPhone === 'string'
    && typeof r.timeStr === 'string'
    && typeof r.total === 'number' && Number.isFinite(r.total)
    && (r.orderType === 'Pickup' || r.orderType === 'Delivery' || r.orderType === 'Walk-In')
    && typeof r.isWalkIn === 'boolean'
    && typeof r.telegramSent === 'boolean'
    && Array.isArray(r.items)
    && r.items.every((i) => i && typeof i === 'object'
      && typeof i.name === 'string'
      && (i.variant == null || typeof i.variant === 'string')
      && typeof i.price === 'number' && Number.isFinite(i.price)
      && typeof i.quantity === 'number' && Number.isFinite(i.quantity));
}
