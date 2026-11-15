import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { paymongoSecret, telegramToken, telegramChatIds } from '../index';
import { cleanStr } from '../util/security';
import {
  fetchSessionPayments,
  hasPaidPayment,
  hasFailedPayment,
  firstPaymentId,
  markOrderPaidOnce,
} from './paymongo';

/** Returns true only when the order is bound to the exact checkout session id. */
export function hasMatchingCheckoutSession(
  orderData: Record<string, any> | undefined,
  sessionId: string,
): boolean {
  const bound = typeof orderData?.checkoutSessionId === 'string'
    ? orderData.checkoutSessionId.trim()
    : '';
  return bound.length > 0 && bound === sessionId;
}

/**
 * Verifies a GCash/PayMongo checkout session directly against PayMongo before
 * the kiosk shows the order receipt. Prevents client-side bypass of unpaid orders.
 */
export const verifyCheckoutPayment = onCall(
  { secrets: [paymongoSecret, telegramToken, telegramChatIds] },
  async (request) => {
    const d = request.data || {};
    const orderDocId = cleanStr(d.orderDocId, 64, 'orderDocId');
    const sessionId = cleanStr(d.checkoutSessionId, 128, 'checkoutSessionId');

    if (!/^[A-Za-z0-9]{1,64}$/.test(orderDocId)) {
      throw new HttpsError('invalid-argument', 'Invalid order reference');
    }
    if (!/^[A-Za-z0-9_-]{4,128}$/.test(sessionId)) {
      throw new HttpsError('invalid-argument', 'Invalid checkout session');
    }

    const db = getFirestore();
    const orderRef = db.collection('orders').doc(orderDocId);
    const snap = await orderRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Order not found');
    }

    const orderData = snap.data()!;
    if (!hasMatchingCheckoutSession(orderData, sessionId)) {
      throw new HttpsError('permission-denied', 'Checkout session does not match order');
    }
    if (orderData.paymentStatus === 'PAID') {
      return { paid: true, paymentStatus: 'PAID' };
    }

    const paymongoKey = paymongoSecret.value();
    if (!paymongoKey) {
      throw new HttpsError('internal', 'Payment service not configured');
    }
    const auth = Buffer.from(`${paymongoKey}:`).toString('base64');

    const payments = await fetchSessionPayments(sessionId, auth);
    if (payments === null) {
      throw new HttpsError('unavailable', 'Unable to verify payment status with provider');
    }

    if (hasPaidPayment(payments)) {
      const paymentId = firstPaymentId(payments);
      await markOrderPaidOnce(orderRef, paymentId, String(orderData.orderId || ''));
      logger.info(`Order ${orderDocId} verified as PAID via callable`);
      return { paid: true, paymentStatus: 'PAID' };
    }

    if (hasFailedPayment(payments)) {
      await db.runTransaction(async (tx) => {
        const latest = await tx.get(orderRef);
        if (!latest.exists || latest.data()?.paymentStatus === 'PAID') return;
        tx.update(orderRef, { paymentStatus: 'PAYMENT_FAILED' });
      });
      return { paid: false, paymentStatus: 'PAYMENT_FAILED' };
    }

    return { paid: false, paymentStatus: String(orderData.paymentStatus || 'AWAITING_PAYMENT') };
  },
);
