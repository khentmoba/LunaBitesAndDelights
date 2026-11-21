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
