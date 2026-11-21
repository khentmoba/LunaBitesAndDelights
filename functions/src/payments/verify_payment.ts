import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { paymongoSecret, telegramToken, telegramChatIds } from '../secrets';
import { ALNUM_DOC_ID, cleanStr } from '../util/security';
import {
  paymongoAuthHeader,
  requireOrderDoc,
  fetchCheckoutSession,
  resolveOrderDocId,
  hasPaidPayment,
  hasPaidPaymentForAmount,
  paidPaymentAmountCentavos,
  hasFailedPayment,
  firstPaymentId,
  markOrderPaidOnce,
  markOrderPaymentFailed,
  hasMatchingCheckoutSession,
} from './paymongo';

export { hasMatchingCheckoutSession };

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

    if (!ALNUM_DOC_ID.test(orderDocId)) {
      throw new HttpsError('invalid-argument', 'Invalid order reference');
    }
    if (!/^[A-Za-z0-9_-]{4,128}$/.test(sessionId)) {
      throw new HttpsError('invalid-argument', 'Invalid checkout session');
    }

    const { orderRef, orderData } = await requireOrderDoc(orderDocId);
    if (!hasMatchingCheckoutSession(orderData, sessionId)) {
      throw new HttpsError('permission-denied', 'Checkout session does not match order');
    }
    if (orderData.paymentStatus === 'PAID') {
      return { paid: true, paymentStatus: 'PAID' };
    }

    const auth = paymongoAuthHeader(true);

    const session = await fetchCheckoutSession(sessionId, auth);
    if (session === null) {
      throw new HttpsError('unavailable', 'Unable to verify payment status with provider');
    }

    const sessionOrderDocId = resolveOrderDocId(session.attributes);
    if (sessionOrderDocId !== orderDocId) {
      logger.warn(
        `Refusing verifyCheckoutPayment for ${orderDocId}: session ${sessionId} belongs to ${sessionOrderDocId}`,
      );
      throw new HttpsError('permission-denied', 'Checkout session does not match order');
    }

    const payments = session.payments;
    if (hasPaidPayment(payments)) {
      const expectedTotal = Number(orderData.totalAmount);
      if (!hasPaidPaymentForAmount(payments, expectedTotal)) {
        logger.warn(
          `Refusing verifyCheckoutPayment for ${orderDocId}: paid amount does not match order total ${expectedTotal}`,
        );
        throw new HttpsError('failed-precondition', 'Paid amount does not match order total');
      }
      const paymentId = firstPaymentId(payments);
      const paidCentavos = paidPaymentAmountCentavos(payments);
      const { transitioned, alreadyPaid } = await markOrderPaidOnce(
        orderRef,
        paymentId,
        String(orderData.orderId || ''),
        sessionId,
        paidCentavos ?? undefined,
      );
      if (!transitioned && !alreadyPaid) {
        throw new HttpsError('failed-precondition', 'Unable to verify payment for order');
      }
      logger.info(`Order ${orderDocId} verified as PAID via callable`);
      return { paid: true, paymentStatus: 'PAID' };
    }

    if (hasFailedPayment(payments)) {
      await markOrderPaymentFailed(orderRef, sessionId);
      return { paid: false, paymentStatus: 'PAYMENT_FAILED' };
    }

    return { paid: false, paymentStatus: String(orderData.paymentStatus || 'AWAITING_PAYMENT') };
  },
);
