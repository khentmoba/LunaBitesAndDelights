"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyCheckoutPayment = void 0;
exports.hasMatchingCheckoutSession = hasMatchingCheckoutSession;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const firebase_functions_1 = require("firebase-functions");
const index_1 = require("../index");
const security_1 = require("../util/security");
const paymongo_1 = require("./paymongo");
/** Returns true only when the order is bound to the exact checkout session id. */
function hasMatchingCheckoutSession(orderData, sessionId) {
    const bound = typeof orderData?.checkoutSessionId === 'string'
        ? orderData.checkoutSessionId.trim()
        : '';
    return bound.length > 0 && bound === sessionId;
}
/**
 * Verifies a GCash/PayMongo checkout session directly against PayMongo before
 * the kiosk shows the order receipt. Prevents client-side bypass of unpaid orders.
 */
exports.verifyCheckoutPayment = (0, https_1.onCall)({ secrets: [index_1.paymongoSecret, index_1.telegramToken, index_1.telegramChatIds] }, async (request) => {
    const d = request.data || {};
    const orderDocId = (0, security_1.cleanStr)(d.orderDocId, 64, 'orderDocId');
    const sessionId = (0, security_1.cleanStr)(d.checkoutSessionId, 128, 'checkoutSessionId');
    if (!/^[A-Za-z0-9]{1,64}$/.test(orderDocId)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid order reference');
    }
    if (!/^[A-Za-z0-9_-]{4,128}$/.test(sessionId)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid checkout session');
    }
    const db = (0, firestore_1.getFirestore)();
    const orderRef = db.collection('orders').doc(orderDocId);
    const snap = await orderRef.get();
    if (!snap.exists) {
        throw new https_1.HttpsError('not-found', 'Order not found');
    }
    const orderData = snap.data();
    if (!hasMatchingCheckoutSession(orderData, sessionId)) {
        throw new https_1.HttpsError('permission-denied', 'Checkout session does not match order');
    }
    if (orderData.paymentStatus === 'PAID') {
        return { paid: true, paymentStatus: 'PAID' };
    }
    const paymongoKey = index_1.paymongoSecret.value();
    if (!paymongoKey) {
        throw new https_1.HttpsError('internal', 'Payment service not configured');
    }
    const auth = Buffer.from(`${paymongoKey}:`).toString('base64');
    const payments = await (0, paymongo_1.fetchSessionPayments)(sessionId, auth);
    if (payments === null) {
        throw new https_1.HttpsError('unavailable', 'Unable to verify payment status with provider');
    }
    if ((0, paymongo_1.hasPaidPayment)(payments)) {
        const paymentId = (0, paymongo_1.firstPaymentId)(payments);
        await (0, paymongo_1.markOrderPaidOnce)(orderRef, paymentId, String(orderData.orderId || ''));
        firebase_functions_1.logger.info(`Order ${orderDocId} verified as PAID via callable`);
        return { paid: true, paymentStatus: 'PAID' };
    }
    if ((0, paymongo_1.hasFailedPayment)(payments)) {
        await db.runTransaction(async (tx) => {
            const latest = await tx.get(orderRef);
            if (!latest.exists || latest.data()?.paymentStatus === 'PAID')
                return;
            tx.update(orderRef, { paymentStatus: 'PAYMENT_FAILED' });
        });
        return { paid: false, paymentStatus: 'PAYMENT_FAILED' };
    }
    return { paid: false, paymentStatus: String(orderData.paymentStatus || 'AWAITING_PAYMENT') };
});
//# sourceMappingURL=verify_payment.js.map