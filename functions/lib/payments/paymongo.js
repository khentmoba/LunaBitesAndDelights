"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymongoAuthHeader = paymongoAuthHeader;
exports.requireOrderDoc = requireOrderDoc;
exports.markOrderPaymentFailed = markOrderPaymentFailed;
exports.fetchSessionPayments = fetchSessionPayments;
exports.hasPaidPayment = hasPaidPayment;
exports.hasFailedPayment = hasFailedPayment;
exports.firstPaymentId = firstPaymentId;
exports.markOrderPaidOnce = markOrderPaidOnce;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const secrets_1 = require("../secrets");
const telegram_api_1 = require("../telegram_api");
const security_1 = require("../util/security");
function paymongoAuthHeader(requireConfigured = false) {
    const key = secrets_1.paymongoSecret.value();
    if (requireConfigured && !key) {
        throw new https_1.HttpsError('internal', 'Payment service not configured');
    }
    return Buffer.from(`${key}:`).toString('base64');
}
async function requireOrderDoc(orderDocId) {
    if (!security_1.ALNUM_DOC_ID.test(orderDocId)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid order reference');
    }
    const orderRef = (0, firestore_1.getFirestore)().collection('orders').doc(orderDocId);
    const snap = await orderRef.get();
    if (!snap.exists) {
        throw new https_1.HttpsError('not-found', 'Order not found');
    }
    return { orderRef, orderData: snap.data() };
}
async function markOrderPaymentFailed(orderRef) {
    await (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
        const snap = await tx.get(orderRef);
        if (!snap.exists || snap.data()?.paymentStatus === 'PAID')
            return;
        tx.update(orderRef, { paymentStatus: 'PAYMENT_FAILED' });
    });
}
/** PayMongo checkout session statuses derived from session payments. */
async function fetchSessionPayments(sessionId, auth) {
    const res = await fetch(`https://api.paymongo.com/v2/checkout_sessions/${sessionId}`, {
        headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok)
        return null;
    const json = await res.json();
    return json?.data?.attributes?.payments || [];
}
function hasPaidPayment(payments) {
    return !!payments?.some((p) => p?.attributes?.status === 'paid');
}
function hasFailedPayment(payments) {
    return !!payments && !hasPaidPayment(payments) &&
        payments.some((p) => p?.attributes?.status === 'failed');
}
function firstPaymentId(payments) {
    const paid = payments?.find((p) => p?.attributes?.status === 'paid');
    return String(paid?.id || payments?.[0]?.id || '');
}
/**
 * Atomically transitions an order to PAID once and notifies Telegram only on
 * that first transition, so webhook and client polling cannot double-notify.
 */
async function markOrderPaidOnce(orderRef, paymentId, fallbackOrderLabel = '') {
    const db = (0, firestore_1.getFirestore)();
    let orderData = null;
    let transitioned = false;
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(orderRef);
        if (!snap.exists)
            return;
        const data = snap.data();
        orderData = data;
        if (data.paymentStatus === 'PAID')
            return;
        transitioned = true;
        tx.set(orderRef, {
            paymentStatus: 'PAID',
            paymongoPaymentId: String(paymentId).slice(0, 128),
            paidAt: new Date().toISOString(),
        }, { merge: true });
    });
    if (transitioned && orderData) {
        const data = orderData;
        const paidAtPht = new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
        try {
            await (0, telegram_api_1.sendToAll)([
                `✅ *PAYMENT CONFIRMED*`,
                `📄 *Order:* ${(0, telegram_api_1.escapeMd)(String(data.orderId || fallbackOrderLabel || orderRef.id))}`,
                `👤 *Customer:* ${(0, telegram_api_1.escapeMd)(String(data.customerName || ''))}`,
                `💰 *Amount:* \u20B1${(0, telegram_api_1.escapeMd)(String(data.totalAmount || 0))}`,
                `💳 *Payment:* GCash via PayMongo`,
                `📦 *Type:* ${(0, telegram_api_1.escapeMd)(String(data.type || ''))}`,
                `🕐 *Paid at:* ${(0, telegram_api_1.escapeMd)(paidAtPht)}`,
            ].join('\n'));
        }
        catch (notifErr) {
            firebase_functions_1.logger.error('Failed to send payment confirmation to Telegram:', notifErr);
        }
    }
    return { transitioned };
}
//# sourceMappingURL=paymongo.js.map