import { getFirestore, DocumentReference } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { paymongoSecret } from '../secrets';
import { escapeMd } from '../telegram_api';
import { ALNUM_DOC_ID } from '../util/security';

export interface VerifiedCheckoutSession {
  payments: any[];
  attributes: Record<string, any>;
}

/** Firestore doc ids are alphanumeric; the legacy display number may hold '-' too. */
const LEGACY_DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Extracts the target Firestore order doc ID from PayMongo session attributes. */
export function resolveOrderDocId(attrs: any): string | null {
  const fromMeta = attrs?.metadata?.order_doc_id;
  if (typeof fromMeta === 'string' && ALNUM_DOC_ID.test(fromMeta)) return fromMeta;
  const fromRef = attrs?.reference_number;
  if (typeof fromRef === 'string' && LEGACY_DOC_ID.test(fromRef)) return fromRef;
  return null;
}

/** Returns true only when the order is bound to the exact checkout session id. */
export function hasMatchingCheckoutSession(
  orderData: Record<string, any> | undefined,
  sessionId: string,
): boolean {
  if (!sessionId) return false;
  const bound = typeof orderData?.checkoutSessionId === 'string'
    ? orderData.checkoutSessionId.trim()
    : '';
  if (bound.length > 0 && bound === sessionId) return true;
  // The first session is the one the customer is most likely to pay on. Keep it
  // valid even after the bounded recent-session list has rotated past it.
  const initial = typeof orderData?.initialCheckoutSessionId === 'string'
    ? orderData.initialCheckoutSessionId.trim()
    : '';
  if (initial.length > 0 && initial === sessionId) return true;
  const list = orderData?.checkoutSessionIds;
  return Array.isArray(list) && list.some((id) => typeof id === 'string' && id.trim() === sessionId);
}

export function paymongoAuthHeader(requireConfigured = false): string {
  const key = paymongoSecret.value().trim();
  if (requireConfigured && !key) {
    throw new HttpsError('internal', 'Payment service not configured');
  }
  return Buffer.from(`${key}:`).toString('base64');
}

export async function requireOrderDoc(orderDocId: string): Promise<{
  orderRef: DocumentReference;
  orderData: Record<string, any>;
}> {
  if (!ALNUM_DOC_ID.test(orderDocId)) {
    throw new HttpsError('invalid-argument', 'Invalid order reference');
  }
  const orderRef = getFirestore().collection('orders').doc(orderDocId);
  const snap = await orderRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Order not found');
  }
  return { orderRef, orderData: snap.data()! };
}

/**
 * True when `sessionId` is the checkout session the customer is currently on.
 * Retries (and PayMongo webhook redeliveries) can report a failure for a session
 * the kiosk has already replaced, so "it is in the history" is not enough.
 */
export function isLiveCheckoutSession(
  orderData: Record<string, any> | undefined,
  sessionId: string,
): boolean {
  if (!sessionId) return false;
  const current = typeof orderData?.checkoutSessionId === 'string'
    ? orderData.checkoutSessionId.trim()
    : '';
  // A primary id is the session the kiosk last handed to the customer.
  if (current.length > 0) return current === sessionId;
  // Legacy orders (and the window before a session is stored) carry no primary
  // id, so fall back to the bounded session history.
  return hasMatchingCheckoutSession(orderData, sessionId);
}

/**
 * Whether a `payment.failed` event for `sessionId` may mark the order failed.
 * A superseded session's late failure must not flip a live checkout to
 * PAYMENT_FAILED, and a payment that already resolved (paid, or expired by the
 * sweep) keeps its terminal status. An empty session id fails closed.
 */
export function shouldMarkPaymentFailed(
  orderData: Record<string, any> | undefined,
  sessionId: string,
): boolean {
  if (!orderData) return false;
  const status = String(orderData.paymentStatus || '');
  if (status === 'PAID' || status === 'PAYMENT_EXPIRED') return false;
  return isLiveCheckoutSession(orderData, sessionId);
}

export async function markOrderPaymentFailed(
  orderRef: DocumentReference,
  expectedSessionId: string,
): Promise<{ updated: boolean; paymentStatus: string }> {
  let updated = false;
  let observed = '';
  await getFirestore().runTransaction(async (tx) => {
    // Firestore re-runs this callback on contention; every attempt must answer
    // for the document it just read, not for an attempt that lost the race.
    updated = false;
    observed = '';
    const snap = await tx.get(orderRef);
    if (!snap.exists) {
      observed = 'missing';
      return;
    }
    const data = snap.data()!;
    observed = String(data.paymentStatus || 'AWAITING_PAYMENT');
    if (!shouldMarkPaymentFailed(data, expectedSessionId)) return;
    updated = true;
    tx.update(orderRef, { paymentStatus: 'PAYMENT_FAILED' });
  });
  // The caller reports what the order actually holds: a concurrent payment or a
  // superseded session leaves the status alone, and the kiosk must see that.
  return { updated, paymentStatus: updated ? 'PAYMENT_FAILED' : observed || 'AWAITING_PAYMENT' };
}

export type CheckoutSessionFetchResult =
  | { status: 'ok'; session: VerifiedCheckoutSession }
  | { status: 'not_found' }
  | { status: 'transient_error' };

/**
 * Fetches the authoritative checkout session from PayMongo, distinguishing
 * permanent 400/404 responses from transient 429/5xx/network errors.
 */
export async function fetchCheckoutSessionDetailed(
  sessionId: string,
  auth: string,
): Promise<CheckoutSessionFetchResult> {
  try {
    const res = await fetch(`https://api.paymongo.com/v2/checkout_sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      if (res.status === 400 || res.status === 404) return { status: 'not_found' };
      return { status: 'transient_error' };
    }
    const json: any = await res.json();
    const attributes = (json?.data?.attributes && typeof json.data.attributes === 'object')
      ? json.data.attributes
      : {};
    const payments = Array.isArray(attributes.payments) ? attributes.payments : [];
    return { status: 'ok', session: { payments, attributes } };
  } catch {
    return { status: 'transient_error' };
  }
}

/** Fetches the authoritative checkout session and its payments from PayMongo. */
export async function fetchCheckoutSession(
  sessionId: string,
  auth: string,
): Promise<VerifiedCheckoutSession | null> {
  const result = await fetchCheckoutSessionDetailed(sessionId, auth);
  return result.status === 'ok' ? result.session : null;
}

/** PayMongo checkout session statuses derived from session payments. */
export async function fetchSessionPayments(sessionId: string, auth: string): Promise<any[] | null> {
  const session = await fetchCheckoutSession(sessionId, auth);
  return session ? session.payments : null;
}

export function hasPaidPayment(payments: any[] | null): boolean {
  return !!payments?.some((p: any) => p?.attributes?.status === 'paid');
}

export function hasFailedPayment(payments: any[] | null): boolean {
  return !!payments && !hasPaidPayment(payments) &&
    payments.some((p: any) => p?.attributes?.status === 'failed');
}

export function firstPaymentId(payments: any[] | null): string {
  const paid = payments?.find((p: any) => p?.attributes?.status === 'paid');
  return String(paid?.id || payments?.[0]?.id || '');
}

/** Returns the integer amount in centavos of the paid PayMongo payment, or null if absent/invalid. */
export function paidPaymentAmountCentavos(payments: any[] | null): number | null {
  const paid = payments?.find((p: any) => p?.attributes?.status === 'paid');
  const amt = paid?.attributes?.amount;
  return typeof amt === 'number' && Number.isInteger(amt) && amt > 0 ? amt : null;
}

/** Returns true only when a paid payment matches the expected PHP order total in centavos. */
export function hasPaidPaymentForAmount(
  payments: any[] | null,
  expectedAmountPhp: number,
): boolean {
  if (!Number.isFinite(expectedAmountPhp) || expectedAmountPhp <= 0) return false;
  const expectedCentavos = Math.round(expectedAmountPhp * 100);
  const paidCentavos = paidPaymentAmountCentavos(payments);
  return paidCentavos !== null && paidCentavos === expectedCentavos;
}

/** Formats the Telegram MarkdownV2 payment confirmation (or refund-review) alert. */
export function formatPaymentConfirmedMessage(
  data: Record<string, any>,
  fallbackOrderLabel: string,
  paidAtPht: string,
): string {
  const wasCancelled = data.status === 'Cancelled';
  return [
    wasCancelled ? `⚠️ *PAYMENT RECEIVED FOR CANCELLED ORDER*` : `✅ *PAYMENT CONFIRMED*`,
    `📄 *Order:* ${escapeMd(String(data.orderId || fallbackOrderLabel))}`,
    `👤 *Customer:* ${escapeMd(String(data.customerName || ''))}`,
    `💰 *Amount:* \u20B1${escapeMd(String(data.totalAmount || 0))}`,
    `💳 *Payment:* GCash via PayMongo`,
    `📦 *Type:* ${escapeMd(String(data.type || ''))}`,
    `🕐 *Paid at:* ${escapeMd(paidAtPht)}`,
    ...(wasCancelled ? [`🚨 *Action needed:* Order was already Cancelled — do not prepare; review for refund\\.`] : []),
  ].join('\n');
}

/**
 * Atomically transitions an order to PAID once so webhook and client polling
 * cannot double-transition. Telegram confirmation and refund-review alerts are
 * emitted durably by `onOrderWritten` (`retry: true`).
 */
export async function markOrderPaidOnce(
  orderRef: DocumentReference,
  paymentId: string,
  _fallbackOrderLabel = '',
  expectedSessionId?: string,
  paidAmountCentavos?: number,
): Promise<{ transitioned: boolean; alreadyPaid: boolean }> {
  const db = getFirestore();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) {
      // A verified payment whose order reference resolves to nothing is the one
      // rejection this function used to make silently.
      logger.warn(`Refusing to mark order ${orderRef.id} PAID: order document does not exist`);
      return { transitioned: false, alreadyPaid: false };
    }
    const data = snap.data()!;
    if (data.paymentStatus === 'PAID') {
      return { transitioned: false, alreadyPaid: true };
    }
    if (expectedSessionId && !hasMatchingCheckoutSession(data, expectedSessionId)) {
      logger.warn(`Refusing to mark order ${orderRef.id} PAID: checkout session mismatch`);
      return { transitioned: false, alreadyPaid: false };
    }
    if (paidAmountCentavos !== undefined) {
      const expectedCentavos = Math.round(Number(data.totalAmount) * 100);
      if (!Number.isFinite(expectedCentavos) || expectedCentavos <= 0 || paidAmountCentavos !== expectedCentavos) {
        logger.warn(
          `Refusing to mark order ${orderRef.id} PAID: amount mismatch (paid=${paidAmountCentavos}, expected=${expectedCentavos})`,
        );
        return { transitioned: false, alreadyPaid: false };
      }
    }
    const paidFields: Record<string, any> = {
      paymentStatus: 'PAID',
      paymongoPaymentId: String(paymentId).slice(0, 128),
      paidAt: new Date().toISOString(),
    };
    if (data.status === 'Cancelled') {
      paidFields.paidAfterCancel = true;
    }
    tx.set(orderRef, paidFields, { merge: true });
    return { transitioned: true, alreadyPaid: false };
  });
}
