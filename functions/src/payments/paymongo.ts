import { getFirestore, DocumentReference } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { paymongoSecret } from '../secrets';
import { sendToAll, escapeMd } from '../telegram_api';
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
  const list = orderData?.checkoutSessionIds;
  return Array.isArray(list) && list.some((id) => typeof id === 'string' && id.trim() === sessionId);
}

export function paymongoAuthHeader(requireConfigured = false): string {
  const key = paymongoSecret.value();
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

export async function markOrderPaymentFailed(
  orderRef: DocumentReference,
  expectedSessionId?: string,
): Promise<{ updated: boolean }> {
  let updated = false;
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;
    const data = snap.data()!;
    if (data.paymentStatus === 'PAID') return;
    if (expectedSessionId && !hasMatchingCheckoutSession(data, expectedSessionId)) return;
    updated = true;
    tx.update(orderRef, { paymentStatus: 'PAYMENT_FAILED' });
  });
  return { updated };
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
    const res = await fetch(`https://api.paymongo.com/v2/checkout_sessions/${sessionId}`, {
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

/**
 * Atomically transitions an order to PAID once and notifies Telegram only on
 * that first transition, so webhook and client polling cannot double-notify.
 */
export async function markOrderPaidOnce(
  orderRef: DocumentReference,
  paymentId: string,
  fallbackOrderLabel = '',
  expectedSessionId?: string,
  paidAmountCentavos?: number,
): Promise<{ transitioned: boolean; alreadyPaid: boolean }> {
  const db = getFirestore();
  let orderData: Record<string, any> | null = null;
  let transitioned = false;
  let alreadyPaid = false;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;
    const data = snap.data()!;
    orderData = data;
    if (data.paymentStatus === 'PAID') {
      alreadyPaid = true;
      return;
    }
    if (expectedSessionId && !hasMatchingCheckoutSession(data, expectedSessionId)) {
      logger.warn(`Refusing to mark order ${orderRef.id} PAID: checkout session mismatch`);
      return;
    }
    if (paidAmountCentavos !== undefined) {
      const expectedCentavos = Math.round(Number(data.totalAmount) * 100);
      if (!Number.isFinite(expectedCentavos) || expectedCentavos <= 0 || paidAmountCentavos !== expectedCentavos) {
        logger.warn(
          `Refusing to mark order ${orderRef.id} PAID: amount mismatch (paid=${paidAmountCentavos}, expected=${expectedCentavos})`,
        );
        return;
      }
    }
    transitioned = true;
    tx.set(orderRef, {
      paymentStatus: 'PAID',
      paymongoPaymentId: String(paymentId).slice(0, 128),
      paidAt: new Date().toISOString(),
    }, { merge: true });
  });

  if (transitioned && orderData) {
    const data = orderData as Record<string, any>;
    const paidAtPht = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
    try {
      await sendToAll([
        `✅ *PAYMENT CONFIRMED*`,
        `📄 *Order:* ${escapeMd(String(data.orderId || fallbackOrderLabel || orderRef.id))}`,
        `👤 *Customer:* ${escapeMd(String(data.customerName || ''))}`,
        `💰 *Amount:* \u20B1${escapeMd(String(data.totalAmount || 0))}`,
        `💳 *Payment:* GCash via PayMongo`,
        `📦 *Type:* ${escapeMd(String(data.type || ''))}`,
        `🕐 *Paid at:* ${escapeMd(paidAtPht)}`,
      ].join('\n'));
    } catch (notifErr) {
      logger.error('Failed to send payment confirmation to Telegram:', notifErr);
    }
  }

  return { transitioned, alreadyPaid };
}
