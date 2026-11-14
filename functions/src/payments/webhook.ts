import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import * as crypto from 'crypto';
import { sendToAll, escapeMd } from '../telegram_api';
import { paymongoSecret, telegramToken, telegramChatIds } from '../index';

// Trust-but-verify: never mark PAID or FAILED from the webhook payload alone.
// Re-fetch the checkout session from PayMongo with the secret key (#6/#8).
async function fetchSessionPayments(sessionId: string, auth: string): Promise<any[] | null> {
  const res = await fetch(`https://api.paymongo.com/v2/checkout_sessions/${sessionId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  return json?.data?.attributes?.payments || [];
}

async function isSessionPaid(sessionId: string, auth: string): Promise<boolean> {
  const payments = await fetchSessionPayments(sessionId, auth);
  if (!payments) return false;
  return payments.some((p: any) => p?.attributes?.status === 'paid');
}

async function isSessionFailed(sessionId: string, auth: string): Promise<boolean> {
  const payments = await fetchSessionPayments(sessionId, auth);
  if (!payments) return false;
  return !payments.some((p: any) => p?.attributes?.status === 'paid') &&
    payments.some((p: any) => p?.attributes?.status === 'failed');
}

export function verifyPaymongoSignature(
  sigHeader: string | string[] | undefined,
  rawBody: Buffer | string | undefined,
  webhookSecret: string | undefined,
): boolean {
  if (!sigHeader || typeof sigHeader !== 'string') return false;
  if (!webhookSecret) return true; // Secret not configured; caller still verifies via PayMongo API.
  if (!rawBody) return false;
  const parts = Object.fromEntries(
    sigHeader.split(',').map((p) => {
      const idx = p.indexOf('=');
      return idx > 0 ? [p.slice(0, idx).trim(), p.slice(idx + 1).trim()] : ['', ''];
    }),
  );
  const t = parts.t;
  const sig = parts.li || parts.te;
  if (!t || !sig) return false;
  const payload = `${t}.${Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody}`;
  const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
  if (expected.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
}

/** Firestore doc ids are alphanumeric; the legacy display number may hold '-' too. */
const DOC_ID = /^[A-Za-z0-9]{1,64}$/;
const LEGACY_DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;

// The kiosk writes the payment result onto the order document it created, and
// passes that document id through PayMongo metadata. reference_number stays the
// human-facing order number, so it can no longer be used as the document key.
export function resolveOrderDocId(attrs: any): string | null {
  const fromMeta = attrs?.metadata?.order_doc_id;
  if (typeof fromMeta === 'string' && DOC_ID.test(fromMeta)) return fromMeta;
  const fromRef = attrs?.reference_number;
  if (typeof fromRef === 'string' && LEGACY_DOC_ID.test(fromRef)) return fromRef;
  return null;
}

export const paymongoWebhook = onRequest(
  { secrets: [paymongoSecret, telegramToken, telegramChatIds] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    if (!verifyPaymongoSignature(
      req.headers['paymongo-signature'],
      (req as any).rawBody,
      process.env.PAYMONGO_WEBHOOK_SECRET,
    )) {
      logger.warn('PayMongo webhook signature invalid or missing');
      res.status(200).send('OK');
      return;
    }

    try {
      const event = req.body?.data;
      if (!event?.type || !event?.data?.id) {
        logger.warn('Invalid webhook payload');
        res.status(200).send('OK');
        return;
      }
      logger.info(`PayMongo webhook received: ${event.type}`);
      const sessionId = String(event.data.id);

      if (event.type === 'checkout_session.payment.paid') {
        const auth = Buffer.from(`${paymongoSecret.value()}:`).toString('base64');
        if (!(await isSessionPaid(sessionId, auth))) {
          logger.warn(`Webhook for ${sessionId} failed API verification — ignored`);
          res.status(200).send('OK');
          return;
        }
        const attrs = event.data.attributes || {};
        const refNumber = attrs.reference_number;
        const paymentId = attrs.payments?.[0]?.id || '';
        const docId = resolveOrderDocId(attrs);
        if (docId) {
          const db = getFirestore();
          const orderRef = db.collection('orders').doc(docId);
          await orderRef.update({
            paymentStatus: 'PAID',
            paymongoPaymentId: String(paymentId).slice(0, 128),
            paidAt: new Date().toISOString(),
          });
          try {
            const orderDoc = await orderRef.get();
            if (orderDoc.exists) {
              const data = orderDoc.data()!;
              await sendToAll([
                `✅ *PAYMENT CONFIRMED*`,
                `📄 *Order:* ${escapeMd(String(data.orderId || refNumber || docId))}`,
                `👤 *Customer:* ${escapeMd(String(data.customerName || ''))}`,
                `💰 *Amount:* \u20B1${escapeMd(String(data.totalAmount || 0))}`,
                `💳 *Payment:* GCash via PayMongo`,
                `📦 *Type:* ${escapeMd(String(data.type || ''))}`,
                `🕐 *Paid at:* ${escapeMd(new Date().toLocaleString('en-PH'))}`,
              ].join('\n'));
            }
          } catch (notifErr) {
            logger.error('Failed to send payment confirmation to Telegram:', notifErr);
          }
          logger.info(`Order ${docId} marked as PAID via verified webhook`);
        }
      }

      if (event.type === 'checkout_session.payment.failed') {
        const auth = Buffer.from(`${paymongoSecret.value()}:`).toString('base64');
        if (!(await isSessionFailed(sessionId, auth))) {
          logger.warn(`Webhook payment.failed for ${sessionId} failed API verification — ignored`);
          res.status(200).send('OK');
          return;
        }
        const docId = resolveOrderDocId(event.data?.attributes || {});
        if (docId) {
          await getFirestore().collection('orders').doc(docId)
            .update({ paymentStatus: 'PAYMENT_FAILED' });
          logger.info(`Order ${docId} payment failed`);
        }
      }

      res.status(200).send('OK');
    } catch (error: any) {
      logger.error('Webhook handler error:', error);
      res.status(200).send('OK'); // always 200 — no info leak, no retry storm
    }
  }
);
