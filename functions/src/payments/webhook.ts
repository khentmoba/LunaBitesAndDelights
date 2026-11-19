import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import * as crypto from 'crypto';
import { paymongoSecret, telegramToken, telegramChatIds } from '../secrets';
import { ALNUM_DOC_ID } from '../util/security';
import {
  paymongoAuthHeader,
  fetchCheckoutSession,
  hasPaidPayment,
  hasFailedPayment,
  firstPaymentId,
  markOrderPaidOnce,
  markOrderPaymentFailed,
} from './paymongo';

const MAX_SIG_AGE_SEC = 300;

export function verifyPaymongoSignature(
  sigHeader: string | string[] | undefined,
  rawBody: Buffer | string | undefined,
  webhookSecret: string | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!sigHeader || typeof sigHeader !== 'string') return false;
  if (!webhookSecret) return true; // Secret not configured; caller verifies session + binding via PayMongo API.
  if (!rawBody) return false;
  const parts = Object.fromEntries(
    sigHeader.split(',').map((p) => {
      const idx = p.indexOf('=');
      return idx > 0 ? [p.slice(0, idx).trim(), p.slice(idx + 1).trim()] : ['', ''];
    }),
  );
  const t = parts.t;
  const sig = parts.li || parts.te;
  if (!t || !/^\d{1,12}$/.test(t) || !sig || !/^[0-9a-f]{64}$/i.test(sig)) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > MAX_SIG_AGE_SEC) return false;
  const payload = `${t}.${Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody}`;
  const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const sigBuf = Buffer.from(sig, 'hex');
  if (expectedBuf.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, sigBuf);
}

/** Firestore doc ids are alphanumeric; the legacy display number may hold '-' too. */
const LEGACY_DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function resolveOrderDocId(attrs: any): string | null {
  const fromMeta = attrs?.metadata?.order_doc_id;
  if (typeof fromMeta === 'string' && ALNUM_DOC_ID.test(fromMeta)) return fromMeta;
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
    try {
      const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
      if (!webhookSecret) {
        logger.warn('PAYMONGO_WEBHOOK_SECRET is not set; relying on PayMongo API session verification');
      }
      if (!verifyPaymongoSignature(
        req.headers['paymongo-signature'],
        (req as any).rawBody,
        webhookSecret,
      )) {
        logger.warn('PayMongo webhook signature invalid or missing');
        res.status(200).send('OK');
        return;
      }

      const event = req.body?.data;
      if (!event?.type || !event?.data?.id) {
        logger.warn('Invalid webhook payload');
        res.status(200).send('OK');
        return;
      }
      logger.info(`PayMongo webhook received: ${event.type}`);
      const sessionId = String(event.data.id);
      if (!/^[A-Za-z0-9_-]{4,128}$/.test(sessionId)) {
        logger.warn('Invalid PayMongo session id in webhook');
        res.status(200).send('OK');
        return;
      }

      if (event.type === 'checkout_session.payment.paid') {
        const session = await fetchCheckoutSession(sessionId, paymongoAuthHeader(true));
        if (!session) {
          logger.error(`Transient failure fetching PayMongo session ${sessionId}`);
          res.status(500).send('Retry');
          return;
        }
        if (!hasPaidPayment(session.payments)) {
          logger.warn(`Webhook for ${sessionId} failed API verification — ignored`);
          res.status(200).send('OK');
          return;
        }
        const attrs = session.attributes;
        const refNumber = String(attrs.reference_number || '');
        const paymentId = firstPaymentId(session.payments);
        const docId = resolveOrderDocId(attrs);
        if (docId) {
          const orderRef = getFirestore().collection('orders').doc(docId);
          const { transitioned } = await markOrderPaidOnce(orderRef, paymentId, refNumber, sessionId);
          if (transitioned) {
            logger.info(`Order ${docId} marked as PAID via verified webhook`);
          }
        }
      }

      if (event.type === 'checkout_session.payment.failed') {
        const session = await fetchCheckoutSession(sessionId, paymongoAuthHeader(true));
        if (!session) {
          logger.error(`Transient failure fetching PayMongo session ${sessionId}`);
          res.status(500).send('Retry');
          return;
        }
        if (!hasFailedPayment(session.payments)) {
          logger.warn(`Webhook payment.failed for ${sessionId} failed API verification — ignored`);
          res.status(200).send('OK');
          return;
        }
        const docId = resolveOrderDocId(session.attributes);
        if (docId) {
          await markOrderPaymentFailed(getFirestore().collection('orders').doc(docId), sessionId);
          logger.info(`Order ${docId} payment failed`);
        }
      }

      res.status(200).send('OK');
    } catch (error: any) {
      logger.error('Webhook handler error:', error);
      res.status(500).send('Retry');
    }
  }
);
