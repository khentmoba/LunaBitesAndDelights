"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymongoWebhook = void 0;
exports.verifyPaymongoSignature = verifyPaymongoSignature;
exports.resolveOrderDocId = resolveOrderDocId;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const firebase_functions_1 = require("firebase-functions");
const crypto = __importStar(require("crypto"));
const telegram_api_1 = require("../telegram_api");
const index_1 = require("../index");
// Trust-but-verify: never mark PAID or FAILED from the webhook payload alone.
// Re-fetch the checkout session from PayMongo with the secret key (#6/#8).
async function fetchSessionPayments(sessionId, auth) {
    const res = await fetch(`https://api.paymongo.com/v2/checkout_sessions/${sessionId}`, {
        headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok)
        return null;
    const json = await res.json();
    return json?.data?.attributes?.payments || [];
}
async function isSessionPaid(sessionId, auth) {
    const payments = await fetchSessionPayments(sessionId, auth);
    if (!payments)
        return false;
    return payments.some((p) => p?.attributes?.status === 'paid');
}
async function isSessionFailed(sessionId, auth) {
    const payments = await fetchSessionPayments(sessionId, auth);
    if (!payments)
        return false;
    return !payments.some((p) => p?.attributes?.status === 'paid') &&
        payments.some((p) => p?.attributes?.status === 'failed');
}
function verifyPaymongoSignature(sigHeader, rawBody, webhookSecret) {
    if (!sigHeader || typeof sigHeader !== 'string')
        return false;
    if (!webhookSecret)
        return true; // Secret not configured; caller still verifies via PayMongo API.
    if (!rawBody)
        return false;
    const parts = Object.fromEntries(sigHeader.split(',').map((p) => {
        const idx = p.indexOf('=');
        return idx > 0 ? [p.slice(0, idx).trim(), p.slice(idx + 1).trim()] : ['', ''];
    }));
    const t = parts.t;
    const sig = parts.li || parts.te;
    if (!t || !sig)
        return false;
    const payload = `${t}.${Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody}`;
    const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
    if (expected.length !== sig.length)
        return false;
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
}
/** Firestore doc ids are alphanumeric; the legacy display number may hold '-' too. */
const DOC_ID = /^[A-Za-z0-9]{1,64}$/;
const LEGACY_DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;
// The kiosk writes the payment result onto the order document it created, and
// passes that document id through PayMongo metadata. reference_number stays the
// human-facing order number, so it can no longer be used as the document key.
function resolveOrderDocId(attrs) {
    const fromMeta = attrs?.metadata?.order_doc_id;
    if (typeof fromMeta === 'string' && DOC_ID.test(fromMeta))
        return fromMeta;
    const fromRef = attrs?.reference_number;
    if (typeof fromRef === 'string' && LEGACY_DOC_ID.test(fromRef))
        return fromRef;
    return null;
}
exports.paymongoWebhook = (0, https_1.onRequest)({ secrets: [index_1.paymongoSecret, index_1.telegramToken, index_1.telegramChatIds] }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }
    if (!verifyPaymongoSignature(req.headers['paymongo-signature'], req.rawBody, process.env.PAYMONGO_WEBHOOK_SECRET)) {
        firebase_functions_1.logger.warn('PayMongo webhook signature invalid or missing');
        res.status(200).send('OK');
        return;
    }
    try {
        const event = req.body?.data;
        if (!event?.type || !event?.data?.id) {
            firebase_functions_1.logger.warn('Invalid webhook payload');
            res.status(200).send('OK');
            return;
        }
        firebase_functions_1.logger.info(`PayMongo webhook received: ${event.type}`);
        const sessionId = String(event.data.id);
        if (event.type === 'checkout_session.payment.paid') {
            const auth = Buffer.from(`${index_1.paymongoSecret.value()}:`).toString('base64');
            if (!(await isSessionPaid(sessionId, auth))) {
                firebase_functions_1.logger.warn(`Webhook for ${sessionId} failed API verification — ignored`);
                res.status(200).send('OK');
                return;
            }
            const attrs = event.data.attributes || {};
            const refNumber = attrs.reference_number;
            const paymentId = attrs.payments?.[0]?.id || '';
            const docId = resolveOrderDocId(attrs);
            if (docId) {
                const db = (0, firestore_1.getFirestore)();
                const orderRef = db.collection('orders').doc(docId);
                await orderRef.update({
                    paymentStatus: 'PAID',
                    paymongoPaymentId: String(paymentId).slice(0, 128),
                    paidAt: new Date().toISOString(),
                });
                try {
                    const orderDoc = await orderRef.get();
                    if (orderDoc.exists) {
                        const data = orderDoc.data();
                        await (0, telegram_api_1.sendToAll)([
                            `✅ *PAYMENT CONFIRMED*`,
                            `📄 *Order:* ${(0, telegram_api_1.escapeMd)(String(data.orderId || refNumber || docId))}`,
                            `👤 *Customer:* ${(0, telegram_api_1.escapeMd)(String(data.customerName || ''))}`,
                            `💰 *Amount:* \u20B1${(0, telegram_api_1.escapeMd)(String(data.totalAmount || 0))}`,
                            `💳 *Payment:* GCash via PayMongo`,
                            `📦 *Type:* ${(0, telegram_api_1.escapeMd)(String(data.type || ''))}`,
                            `🕐 *Paid at:* ${(0, telegram_api_1.escapeMd)(new Date().toLocaleString('en-PH'))}`,
                        ].join('\n'));
                    }
                }
                catch (notifErr) {
                    firebase_functions_1.logger.error('Failed to send payment confirmation to Telegram:', notifErr);
                }
                firebase_functions_1.logger.info(`Order ${docId} marked as PAID via verified webhook`);
            }
        }
        if (event.type === 'checkout_session.payment.failed') {
            const auth = Buffer.from(`${index_1.paymongoSecret.value()}:`).toString('base64');
            if (!(await isSessionFailed(sessionId, auth))) {
                firebase_functions_1.logger.warn(`Webhook payment.failed for ${sessionId} failed API verification — ignored`);
                res.status(200).send('OK');
                return;
            }
            const docId = resolveOrderDocId(event.data?.attributes || {});
            if (docId) {
                await (0, firestore_1.getFirestore)().collection('orders').doc(docId)
                    .update({ paymentStatus: 'PAYMENT_FAILED' });
                firebase_functions_1.logger.info(`Order ${docId} payment failed`);
            }
        }
        res.status(200).send('OK');
    }
    catch (error) {
        firebase_functions_1.logger.error('Webhook handler error:', error);
        res.status(200).send('OK'); // always 200 — no info leak, no retry storm
    }
});
//# sourceMappingURL=webhook.js.map