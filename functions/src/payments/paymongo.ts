import { getFirestore, DocumentReference } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { paymongoSecret } from '../secrets';
import { sendToAll, escapeMd } from '../telegram_api';
import { ALNUM_DOC_ID } from '../util/security';

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

export async function markOrderPaymentFailed(orderRef: DocumentReference): Promise<void> {
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists || snap.data()?.paymentStatus === 'PAID') return;
    tx.update(orderRef, { paymentStatus: 'PAYMENT_FAILED' });
  });
}

/** PayMongo checkout session statuses derived from session payments. */
export async function fetchSessionPayments(sessionId: string, auth: string): Promise<any[] | null> {
  const res = await fetch(`https://api.paymongo.com/v2/checkout_sessions/${sessionId}`, {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  return json?.data?.attributes?.payments || [];
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

/**
 * Atomically transitions an order to PAID once and notifies Telegram only on
 * that first transition, so webhook and client polling cannot double-notify.
 */
export async function markOrderPaidOnce(
  orderRef: DocumentReference,
  paymentId: string,
  fallbackOrderLabel = '',
): Promise<{ transitioned: boolean }> {
  const db = getFirestore();
  let orderData: Record<string, any> | null = null;
  let transitioned = false;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;
    const data = snap.data()!;
    orderData = data;
    if (data.paymentStatus === 'PAID') return;
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

  return { transitioned };
}
