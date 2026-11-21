import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import * as crypto from 'crypto';
import { paymongoSecret, telegramToken, telegramChatIds } from '../secrets';
import { clientIpFromRequest, enforceFixedWindowRateLimit } from '../util/security';
import {
  paymongoAuthHeader,
  fetchCheckoutSessionDetailed,
  resolveOrderDocId,
  hasPaidPayment,
  paidPaymentAmountCentavos,
  hasFailedPayment,
  firstPaymentId,
  markOrderPaidOnce,
  markOrderPaymentFailed,
} from './paymongo';

export { resolveOrderDocId };

const MAX_SIG_AGE_SEC = 300;
const WEBHOOK_RATE_WINDOW_MS = 60 * 1000;
const WEBHOOK_RATE_MAX = 120;

/**
 * Extracts `{ type, sessionId }` from PayMongo's JSON:API webhook envelope
 * (`data.attributes.{type, data.id}`) as well as flat legacy payloads (`data.{type, data.id}`).
 */
export function extractPaymongoWebhookEvent(
  body: unknown,
): { type: string; sessionId: string } | null {
  const root = (body as { data?: any } | null | undefined)?.data;
  if (!root || typeof root !== 'object') return null;
  const candidate =
    root.attributes && typeof root.attributes === 'object' && typeof root.attributes.type === 'string'
      ? root.attributes
      : root;
  const type = typeof candidate?.type === 'string' ? candidate.type : '';
  const rawId = candidate?.data?.id;
  const sessionId = typeof rawId === 'string' ? rawId : '';
  if (!type || !sessionId) return null;
  return { type, sessionId };
}

export function verifyPaymongoSignature(
  sigHeader: string | string[] | undefined,
  rawBody: Buffer | string | undefined,
  webhookSecret: string | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!sigHeader || typeof sigHeader !== 'string') return false;
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
  if (!webhookSecret) return true; // Secret not provisioned yet; format + timestamp checked, and caller verifies session via PayMongo API.
  if (!rawBody) return false;
  const payload = `${t}.${Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody}`;
  const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const sigBuf = Buffer.from(sig, 'hex');
  if (expectedBuf.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, sigBuf);
}

export const paymongoWebhook = onRequest(
  { secrets: [paymongoSecret, telegramToken, telegramChatIds] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    try {
      const clientIp = clientIpFromRequest(req) || 'unknown';
      try {
        await enforceFixedWindowRateLimit(
          `webhook:paymongo:${clientIp}`,
          WEBHOOK_RATE_MAX,
          WEBHOOK_RATE_WINDOW_MS,
        );
      } catch (rateErr) {
        if (rateErr instanceof HttpsError && rateErr.code === 'resource-exhausted') {
          res.status(429).send('Too Many Requests');
          return;
        }
        logger.error('PayMongo webhook rate-limit check failed:', rateErr);
        res.status(500).send('Retry');
        return;
      }

      const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;
      if (!webhookSecret) {
        logger.warn('PAYMONGO_WEBHOOK_SECRET is not set; relying on signature format check and PayMongo API session verification');
      }
      if (!verifyPaymongoSignature(
        req.headers['paymongo-signature'],
        (req as any).rawBody,
        webhookSecret,
      )) {
        logger.warn('PayMongo webhook signature invalid or missing');
        res.status(401).send('Invalid signature');
        return;
      }

      const event = extractPaymongoWebhookEvent(req.body);
      if (!event) {
        logger.warn('Invalid webhook payload');
        res.status(200).send('OK');
        return;
      }
      logger.info(`PayMongo webhook received: ${event.type}`);
      const sessionId = event.sessionId;
      if (!/^[A-Za-z0-9_-]{4,128}$/.test(sessionId)) {
        logger.warn('Invalid PayMongo session id in webhook');
        res.status(200).send('OK');
        return;
      }

      if (event.type === 'checkout_session.payment.paid') {
        const fetched = await fetchCheckoutSessionDetailed(sessionId, paymongoAuthHeader(true));
        if (fetched.status === 'not_found') {
          logger.warn(`PayMongo session ${sessionId} not found — ignoring webhook`);
          res.status(200).send('OK');
          return;
        }
        if (fetched.status !== 'ok') {
          logger.error(`Transient failure fetching PayMongo session ${sessionId}`);
          res.status(500).send('Retry');
          return;
        }
        const session = fetched.session;
        if (!hasPaidPayment(session.payments)) {
          logger.warn(`Webhook for ${sessionId} failed API verification — ignored`);
          res.status(200).send('OK');
          return;
        }
        const attrs = session.attributes;
        const refNumber = String(attrs.reference_number || '');
        const paymentId = firstPaymentId(session.payments);
        const paidCentavos = paidPaymentAmountCentavos(session.payments);
        const docId = resolveOrderDocId(attrs);
        if (docId && paidCentavos !== null) {
          const orderRef = getFirestore().collection('orders').doc(docId);
          const { transitioned } = await markOrderPaidOnce(
            orderRef,
            paymentId,
            refNumber,
            sessionId,
            paidCentavos,
          );
          if (transitioned) {
            logger.info(`Order ${docId} marked as PAID via verified webhook`);
          }
        }
      }

      if (event.type === 'checkout_session.payment.failed') {
        const fetched = await fetchCheckoutSessionDetailed(sessionId, paymongoAuthHeader(true));
        if (fetched.status === 'not_found') {
          logger.warn(`PayMongo session ${sessionId} not found — ignoring payment.failed webhook`);
          res.status(200).send('OK');
          return;
        }
        if (fetched.status !== 'ok') {
          logger.error(`Transient failure fetching PayMongo session ${sessionId}`);
          res.status(500).send('Retry');
          return;
        }
        const session = fetched.session;
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
