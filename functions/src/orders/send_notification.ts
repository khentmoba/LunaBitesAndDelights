import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp, Firestore } from 'firebase-admin/firestore';
import { sendToAll, sendPhotoToAll, escapeMd, isPermanentTelegramError, hasTelegramConfig } from '../telegram_api';
import { telegramToken, telegramChatIds, googleMapsApiKey } from '../secrets';
import { logger } from 'firebase-functions';
import { ALNUM_DOC_ID, cleanStr, clientIpFromRequest, enforceFixedWindowRateLimit } from '../util/security';
import { isOrderVisibleInKds } from './kds';
import { formatPaymentConfirmedMessage } from '../payments/paymongo';

const NOTIF_RATE_WINDOW_MS = 10 * 60 * 1000;
const NOTIF_RATE_MAX = 20;
const ORDER_NOTIF_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ORDER_TYPES = ['Walk-In', 'Pickup', 'Delivery'];
const MAX_ITEMS = 50;

export const itemLines = (items: any[]): string =>
  items
    .map((i: any) => {
      const variantText = i.variant?.length > 0 ? ` \\(${escapeMd(i.variant)}\\)` : '';
      return `  • ${escapeMd(i.quantity)}x ${escapeMd(i.name)}${variantText} — ₱${escapeMd((i.price * i.quantity).toString())}`;
    })
    .join('\n');

export interface OrderNotificationData {
  orderNumber: string;
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
  items: Array<{ name: string; variant?: string; price: number; quantity: number }>;
  total: number;
  timeStr?: string;
  orderType: string;
  deliveryFee?: number;
  paymentMethod?: string;
  paymentStatus?: string;
  lat?: number | null;
  lng?: number | null;
}

export function formatOrderNotification(data: OrderNotificationData): string {
  const isWalkIn = data.orderType === 'Walk-In';
  const isPickup = data.orderType === 'Pickup';
  const lines = itemLines(data.items);

  return isWalkIn
    ? [
      `🔔 *WALK\\-IN ORDER — ${escapeMd(data.orderNumber)}*`,
      `🏪 *Type:* Walk\\-In  \\[STAFF ENTRY\\]`,
      '',
      `👤 *Name:* ${escapeMd(data.customerName)}`,
      `📞 *Phone:* ${escapeMd(data.customerPhone || '')}`,
      '',
      `🛒 *Items:*`,
      lines,
      '',
      `💳 *Payment:* ${escapeMd(data.paymentMethod || 'Cash')}  \\-  ✅ *${escapeMd(data.paymentStatus || 'PAID')}*`,
      '',
      `💰 *TOTAL:* ₱*${escapeMd(data.total.toString())}*`,
      `🕐 *Time:* ${escapeMd(data.timeStr || '')}`,
      '',
      `✅ _Walk\\-in complete — paid at POS\\._`
    ].join('\n')
    : [
      `🔔 *NEW ORDER — ${escapeMd(data.orderNumber)}*`,
      `${isPickup ? '🏪' : '🛵'} *Type:* ${escapeMd(data.orderType || '')}`,
      '',
      `👤 *Name:* ${escapeMd(data.customerName)}`,
      ...(isPickup ? [] : [`📍 *Address:* ${escapeMd(data.customerAddress || '')}`]),
      ...(!isPickup && data.lat != null && data.lng != null
        ? [`🗺 [Get Directions on Google Maps](${getGoogleMapsNavigationUrl(data.lat, data.lng)})`]
        : []),
      `📞 *Phone:* ${escapeMd(data.customerPhone || '')}`,
      '',
      `🛒 *Items:*`,
      lines,
      '',
      ...(isPickup ? [] : ['🚚 *Delivery Fee:* Confirmed by rider; charged separately']),
      `💳 *Payment Method:* ${escapeMd(data.paymentMethod || 'Cash')}`,
      `📝 *Payment Status:* ${escapeMd(data.paymentStatus || 'NOT PAID')}${data.paymentStatus === 'AWAITING_PAYMENT' ? ' \\(GCash\\)' : ''}`,
      '',
      `💰 *${isPickup ? 'TOTAL' : 'FOOD TOTAL'}:* ₱*${escapeMd(data.total.toString())}*`,
      `🕐 *Time:* ${escapeMd(data.timeStr || '')}`,
      '',
      `✅ _Please prepare this order\\!_`
    ].join('\n');
}

function truncateField(value: string | null | undefined, maxChars: number): string {
  const s = String(value ?? '').trim();
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(1, maxChars - 1))}…`;
}

/** Concise summary caption for photos when the full receipt exceeds Telegram's 1024-char caption limit. */
export function formatDeliverySummaryCaption(data: OrderNotificationData): string {
  const build = (addrMax: number) => [
    `🔔 *NEW DELIVERY — ${escapeMd(truncateField(data.orderNumber, 40))}*`,
    `🛵 *Type:* Delivery`,
    '',
    `👤 *Name:* ${escapeMd(truncateField(data.customerName, 80))}`,
    `📍 *Address:* ${escapeMd(truncateField(data.customerAddress, addrMax))}`,
    `📞 *Phone:* ${escapeMd(truncateField(data.customerPhone, 32))}`,
    '',
    `💰 *FOOD TOTAL:* ₱*${escapeMd(data.total.toString())}*`,
    `💳 *Payment:* ${escapeMd(data.paymentMethod || 'Cash')}  \\-  *${escapeMd(data.paymentStatus || 'NOT PAID')}*`,
    `🕐 *Time:* ${escapeMd(truncateField(data.timeStr, 40))}`,
    '',
    `📋 _Full itemized list sent below\\._`,
  ].join('\n');

  let caption = build(240);
  if (caption.length > 1024) caption = build(100);
  if (caption.length > 1024) caption = build(40);
  return caption;
}

/** Generates Google Static Maps URL in hybrid mode (satellite imagery + road names). */
export function getGoogleStaticMapUrl(lat: number, lng: number, apiKey: string): string {
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: '17',
    size: '600x400',
    scale: '2',
    maptype: 'hybrid',
    markers: `color:red|${lat},${lng}`,
    key: apiKey,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

/** Fallback: Generates MapTiler Static Map URL. */
export function getMapTilerStaticMapUrl(lat: number, lng: number, apiKey: string): string {
  return `https://api.maptiler.com/maps/streets-v2/static/${lng},${lat},17/600x400@2x.png?key=${encodeURIComponent(apiKey.trim())}&markers=${lng},${lat}`;
}

/** Universal Google Maps navigation URL for turn-by-turn directions. */
export function getGoogleMapsNavigationUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

const MAX_MAP_IMAGE_BYTES = 5 * 1024 * 1024;

/** Safely fetches a static map image buffer with an abort timeout. Returns null on failure. */
export async function fetchMapImage(url: string, timeoutMs = 6000): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      logger.warn(`Static map fetch failed: status ${res.status} (${res.statusText})`);
      return null;
    }
    const contentType = res.headers?.get?.('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('image/')) {
      logger.warn(`Static map fetch rejected unexpected content-type: ${contentType || 'missing'}`);
      return null;
    }
    const contentLength = Number(res.headers?.get?.('content-length') ?? '');
    if (Number.isFinite(contentLength) && contentLength > MAX_MAP_IMAGE_BYTES) {
      logger.warn(`Static map fetch rejected oversized content-length: ${contentLength}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_MAP_IMAGE_BYTES) {
      logger.warn(`Static map fetch rejected invalid payload size: ${arrayBuffer.byteLength}`);
      return null;
    }
    return Buffer.from(arrayBuffer);
  } catch (err: any) {
    logger.warn('Error fetching static map image', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function resolveStaticMapUrl(lat: number, lng: number): string | null {
  let gmapKey = '';
  try {
    gmapKey = googleMapsApiKey.value().trim();
  } catch {
    gmapKey = '';
  }
  gmapKey ||= (process.env.GOOGLE_MAPS_API_KEY || '').trim();
  if (gmapKey) return getGoogleStaticMapUrl(lat, lng, gmapKey);
  const maptilerKey = (process.env.MAPTILER_KEY || '').trim();
  return maptilerKey ? getMapTilerStaticMapUrl(lat, lng, maptilerKey) : null;
}

export async function sendDeliveryNotification(
  data: OrderNotificationData,
  message: string,
  lat: number,
  lng: number,
  photoAlreadySent = false,
  onPhotoSent?: () => Promise<void>,
  skipChatIds: string[] = [],
): Promise<string[]> {
  if (photoAlreadySent) {
    const res = await sendToAll(message, { skipChatIds });
    return res.deliveredChatIds;
  }
  const replyMarkup = {
    inline_keyboard: [[{ text: '📍 Open in Google Maps 🧭', url: getGoogleMapsNavigationUrl(lat, lng) }]],
  };
  const mapUrl = resolveStaticMapUrl(lat, lng);
  const isSplitMode = message.length > 1024;
  let sentSplitPhoto = false;
  let photoDelivered: string[] = [];
  if (mapUrl) {
    try {
      const imageBuffer = await fetchMapImage(mapUrl);
      if (imageBuffer) {
        if (!isSplitMode) {
          const res = await sendPhotoToAll(imageBuffer, message, { reply_markup: replyMarkup, skipChatIds });
          // Persist the side effect before returning: if the notification-state
          // write that follows fails, the reconciler must not re-send the photo.
          if (onPhotoSent) {
            await onPhotoSent().catch((e) => logger.warn(`Could not persist photoSent for ${data.orderNumber}`, e));
          }
          return res.deliveredChatIds;
        }
        const summaryCaption = formatDeliverySummaryCaption(data);
        await sendPhotoToAll(imageBuffer, summaryCaption, { reply_markup: replyMarkup, skipChatIds });
        sentSplitPhoto = true;
        if (onPhotoSent) {
          await onPhotoSent().catch((e) => logger.warn(`Could not persist photoSent for ${data.orderNumber}`, e));
        }
      }
    } catch (photoError: any) {
      if (!isSplitMode && Array.isArray(photoError?.deliveredChatIds)) {
        photoDelivered = photoError.deliveredChatIds;
      }
      logger.warn(`Photo delivery failed for ${data.orderNumber}, falling back to text`, photoError);
    }
  }
  if (sentSplitPhoto) {
    const res = await sendToAll(message, { skipChatIds });
    return res.deliveredChatIds;
  }
  const mergedSkip = Array.from(new Set([...skipChatIds, ...photoDelivered]));
  try {
    const res = await sendToAll(message, { reply_markup: replyMarkup, skipChatIds: mergedSkip });
    return Array.from(new Set([...photoDelivered, ...res.deliveredChatIds]));
  } catch (textErr: any) {
    if (photoDelivered.length > 0) {
      const textDelivered = Array.isArray(textErr?.deliveredChatIds) ? textErr.deliveredChatIds : [];
      textErr.deliveredChatIds = Array.from(new Set([...photoDelivered, ...textDelivered]));
    }
    throw textErr;
  }
}

/** Builds notification data strictly from the authoritative Firestore order document. */
export function notificationDataFromOrder(
  orderData: Record<string, any>,
  fallbackOrderId: string,
  timeStrOverride = '',
): OrderNotificationData {
  const orderType = ORDER_TYPES.includes(orderData.type) ? orderData.type : 'Pickup';
  const rawItems = Array.isArray(orderData.items) ? orderData.items : [];
  const items = rawItems.slice(0, MAX_ITEMS).map((i: any) => ({
    name: String(i?.name || 'Unknown').slice(0, 120),
    variant: String(i?.variant || '').slice(0, 120),
    price: Number(i?.price) || 0,
    quantity: Number(i?.quantity ?? i?.qty) || 1,
  }));
  const lat = typeof orderData.lat === 'number' && Number.isFinite(orderData.lat) && Math.abs(orderData.lat) <= 90
    ? orderData.lat
    : null;
  const lng = typeof orderData.lng === 'number' && Number.isFinite(orderData.lng) && Math.abs(orderData.lng) <= 180
    ? orderData.lng
    : null;

  let timeStr = timeStrOverride;
  if (!timeStr) {
    const rawTs = orderData.timestamp;
    const d = typeof rawTs?.toDate === 'function' ? rawTs.toDate() : new Date();
    const pht = new Date(d.getTime() + 8 * 3600_000);
    const two = (n: number) => String(n).padStart(2, '0');
    timeStr = `${pht.getUTCFullYear()}-${two(pht.getUTCMonth() + 1)}-${two(pht.getUTCDate())}  ${two(pht.getUTCHours())}:${two(pht.getUTCMinutes())}`;
  }

  return {
    orderNumber: String(orderData.orderId || fallbackOrderId),
    customerName: String(orderData.customerName || ''),
    customerAddress: String(orderData.customerAddress || ''),
    customerPhone: String(orderData.customerPhone || ''),
    items,
    total: Number(orderData.totalAmount) || 0,
    timeStr,
    orderType,
    deliveryFee: Number(orderData.deliveryFee) || 0,
    paymentMethod: String(orderData.paymentMethod || 'Cash'),
    paymentStatus: String(orderData.paymentStatus || 'NOT PAID'),
    lat,
    lng,
  };
}

export const TELEGRAM_CLAIM_TTL_MS = 60_000;

export type ClaimStatus = 'claimed' | 'already-sent' | 'in-flight' | 'missing' | 'failed-permanent';

/** Evaluates whether a notification can be claimed, was already sent, permanently failed, or is actively in-flight within TTL. */
export function evaluateNotificationClaim(
  current: Record<string, any> | undefined,
  nowMs = Date.now(),
): ClaimStatus {
  if (!current) return 'missing';
  if (current.telegramSent === true) return 'already-sent';
  if (current.telegramStatus === 'failed_permanent') return 'failed-permanent';
  if (current.telegramStatus === 'sending') {
    const claimedAt = current.telegramClaimedAt;
    if (typeof claimedAt === 'number' && Number.isFinite(claimedAt) && nowMs - claimedAt < TELEGRAM_CLAIM_TTL_MS) {
      return 'in-flight';
    }
  }
  return 'claimed';
}

/** Returns true if a notification can be claimed (not sent, not permanently failed, and not actively claimed within TTL). */
export function canClaimNotification(current: Record<string, any> | undefined, nowMs = Date.now()): boolean {
  return evaluateNotificationClaim(current, nowMs) === 'claimed';
}

export function hasOrderNotificationState(current: Record<string, any> | undefined): boolean {
  if (!current) return false;
  return typeof current.telegramSent === 'boolean'
    || typeof current.telegramStatus === 'string'
    || typeof current.telegramClaimedAt === 'number'
    || typeof current.attempts === 'number'
    || typeof current.reconcileAttempts === 'number'
    || Array.isArray(current.deliveredChatIds)
    || current.photoSent === true;
}

/** Evaluates whether a payment confirmation/refund Telegram alert can be claimed. */
export function evaluatePaymentNotificationClaim(
  current: Record<string, any> | undefined,
  nowMs = Date.now(),
): ClaimStatus {
  if (!current) return 'missing';
  if (current.paymentNotifSent === true) return 'already-sent';
  if (current.paymentNotifStatus === 'failed_permanent') return 'failed-permanent';
  if (current.paymentNotifStatus === 'sending') {
    const claimedAt = current.paymentNotifClaimedAt;
    if (typeof claimedAt === 'number' && Number.isFinite(claimedAt) && nowMs - claimedAt < TELEGRAM_CLAIM_TTL_MS) {
      return 'in-flight';
    }
  }
  return 'claimed';
}

export const ORDER_NOTIFICATIONS_COLLECTION = 'order_notifications';

/**
 * Atomically claims and sends the Telegram payment confirmation (or cancelled-order
 * refund-review) alert for an order, deduplicated in `order_notifications/{orderDocId}`.
 * Tracks `paymentDeliveredChatIds` across retries and separates Telegram delivery from
 * Firestore completion persistence so transient DB errors never trigger duplicate alerts.
 */
export async function notifyPaymentConfirmedOnce(
  orderDocId: string,
  orderData: Record<string, any>,
  opts: { db?: Firestore; persistBackoffMs?: number[]; source?: 'trigger' | 'reconciler' } = {},
): Promise<{ sent: boolean; alreadySent: boolean; inFlight?: boolean; permanentFailure?: boolean }> {
  const db = opts.db ?? getFirestore();
  const notifRef = db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc(orderDocId);
  const nowMs = Date.now();
  const expireAt = Timestamp.fromMillis(nowMs + ORDER_NOTIF_TTL_MS);

  const { status: claimStatus, deliveredChatIds } = await db.runTransaction<{
    status: ClaimStatus;
    deliveredChatIds: string[];
  }>(async (tx) => {
    const snap = await tx.get(notifRef);
    const existing = snap.exists ? snap.data() : {};
    const status = evaluatePaymentNotificationClaim(existing, nowMs);
    const prevDelivered = Array.isArray(existing?.paymentDeliveredChatIds)
      ? existing.paymentDeliveredChatIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (status === 'claimed') {
      const claimWrite: Record<string, unknown> = {
        paymentNotifStatus: 'sending',
        paymentNotifClaimedAt: nowMs,
        expireAt,
      };
      if (opts.source === 'reconciler') {
        const prevReconcileAttempts = typeof existing?.paymentReconcileAttempts === 'number' &&
          Number.isFinite(existing.paymentReconcileAttempts)
          ? existing.paymentReconcileAttempts
          : 0;
        claimWrite.paymentReconcileAttempts = prevReconcileAttempts + 1;
      }
      tx.set(notifRef, claimWrite, { merge: true });
    }
    return { status, deliveredChatIds: prevDelivered };
  });

  if (claimStatus === 'in-flight') {
    return { sent: false, alreadySent: false, inFlight: true };
  }
  if (claimStatus === 'failed-permanent') {
    return { sent: false, alreadySent: false, inFlight: false, permanentFailure: true };
  }
  if (claimStatus !== 'claimed') {
    return { sent: false, alreadySent: true, inFlight: false };
  }

  const paidDate = typeof orderData.paidAt === 'string' && !Number.isNaN(Date.parse(orderData.paidAt))
    ? new Date(orderData.paidAt)
    : new Date();
  const paidAtPht = paidDate.toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
  const message = formatPaymentConfirmedMessage(orderData, orderDocId, paidAtPht);

  let newlyDelivered: string[];
  try {
    const res = await sendToAll(message, { skipChatIds: deliveredChatIds });
    newlyDelivered = res.deliveredChatIds;
  } catch (error: any) {
    const partialDelivered = Array.isArray(error?.deliveredChatIds)
      ? error.deliveredChatIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : [];
    const mergedDelivered = Array.from(new Set([...deliveredChatIds, ...partialDelivered]));
    const permanent = isPermanentTelegramError(error);
    await notifRef.set(
      {
        paymentNotifSent: false,
        paymentNotifStatus: permanent ? 'failed_permanent' : 'failed',
        paymentDeliveredChatIds: mergedDelivered,
        paymentLastError: String(error?.message || 'unknown').slice(0, 500),
      },
      { merge: true },
    ).catch((e) => {
      logger.warn(`Could not record failed payment notification status for ${orderDocId}`, e);
    });
    logger.error(`Error sending Telegram payment notification for ${orderDocId}`, error);
    throw error;
  }

  const allDelivered = Array.from(new Set([...deliveredChatIds, ...newlyDelivered]));
  const sentPayload = {
    paymentNotifSent: true,
    paymentNotifStatus: 'sent',
    paymentDeliveredChatIds: allDelivered,
    paymentNotifSentAt: Timestamp.now(),
    paymentLastError: null,
  };
  const persistBackoffMs = opts.persistBackoffMs ?? [0, 250, 500, 1000];
  let lastPersistErr: unknown = null;
  for (let attempt = 0; attempt < persistBackoffMs.length; attempt++) {
    if (persistBackoffMs[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, persistBackoffMs[attempt]));
    }
    try {
      await notifRef.set(sentPayload, { merge: true });
      lastPersistErr = null;
      break;
    } catch (err) {
      lastPersistErr = err;
    }
  }
  if (lastPersistErr !== null) {
    logger.error(
      `Telegram payment notification sent for ${orderDocId} but failed to persist sent state after ${persistBackoffMs.length} attempts`,
      { error: lastPersistErr },
    );
  }
  return { sent: true, alreadySent: false };
}

/**
 * Atomically claims Telegram notification delivery for an order in a separate
 * `order_notifications/{orderDocId}` collection so concurrent trigger + callable
 * invocations never double-send and claiming does not re-trigger `onOrderWritten`.
 * Persists `deliveredChatIds` across retries so partial multi-chat failures only
 * retry the undelivered chats without spamming chats that already received the order.
 */
export async function notifyOrderOnce(
  orderDocId: string,
  orderData: Record<string, any>,
  timeStrOverride = '',
  opts: { forceRetry?: boolean; source?: 'trigger' | 'callable' | 'reconciler' } = {},
): Promise<{ sent: boolean; alreadySent: boolean; inFlight?: boolean; permanentFailure?: boolean }> {
  if (orderData.telegramSent === true) {
    return { sent: false, alreadySent: true, inFlight: false };
  }

  const db = getFirestore();
  const notifRef = db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc(orderDocId);

  const nowMs = Date.now();
  const expireAt = Timestamp.fromMillis(nowMs + ORDER_NOTIF_TTL_MS);
  const { status: claimStatus, photoSent, deliveredChatIds } = await db.runTransaction<{
    status: ClaimStatus;
    photoSent: boolean;
    deliveredChatIds: string[];
  }>(async (tx) => {
    const snap = await tx.get(notifRef);
    const existing = snap.exists ? snap.data() : {};
    let status = evaluateNotificationClaim(existing, nowMs);
    if (status === 'failed-permanent' && opts.forceRetry) {
      status = 'claimed';
    }
    const prevAttempts = typeof existing?.attempts === 'number' && Number.isFinite(existing.attempts)
      ? existing.attempts
      : 0;
    const prevReconcileAttempts = typeof existing?.reconcileAttempts === 'number' && Number.isFinite(existing.reconcileAttempts)
      ? existing.reconcileAttempts
      : 0;
    const prevDelivered = Array.isArray(existing?.deliveredChatIds)
      ? existing.deliveredChatIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (status === 'claimed') {
      const claimWrite: Record<string, unknown> = {
        telegramStatus: 'sending',
        telegramClaimedAt: nowMs,
        lastAttemptAt: nowMs,
        attempts: prevAttempts + 1,
        expireAt,
      };
      if (opts.source === 'reconciler') {
        claimWrite.reconcileAttempts = prevReconcileAttempts + 1;
      }
      tx.set(notifRef, claimWrite, { merge: true });
    }
    return { status, photoSent: existing?.photoSent === true, deliveredChatIds: prevDelivered };
  });

  if (claimStatus === 'in-flight') {
    return { sent: false, alreadySent: false, inFlight: true };
  }
  if (claimStatus === 'failed-permanent') {
    return { sent: false, alreadySent: false, inFlight: false, permanentFailure: true };
  }
  if (claimStatus !== 'claimed') {
    return { sent: false, alreadySent: true, inFlight: false };
  }

  const data = notificationDataFromOrder(orderData, orderDocId, timeStrOverride);
  const message = formatOrderNotification(data);

  logger.info(`Sending order notification for ${data.orderNumber} to Telegram`, {
    orderDocId,
    skipChatCount: deliveredChatIds.length,
  });

  let newlyDelivered: string[];
  try {
    if (data.orderType === 'Delivery' && data.lat != null && data.lng != null) {
      newlyDelivered = await sendDeliveryNotification(
        data,
        message,
        data.lat,
        data.lng,
        photoSent,
        async () => {
          await notifRef.set({ photoSent: true }, { merge: true });
        },
        deliveredChatIds,
      );
    } else {
      const res = await sendToAll(message, { skipChatIds: deliveredChatIds });
      newlyDelivered = res.deliveredChatIds;
    }
  } catch (error: any) {
    const partialDelivered = Array.isArray(error?.deliveredChatIds)
      ? error.deliveredChatIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : [];
    const mergedDelivered = Array.from(new Set([...deliveredChatIds, ...partialDelivered]));
    const permanent = isPermanentTelegramError(error);
    await notifRef.set(
      {
        telegramSent: false,
        telegramStatus: permanent ? 'failed_permanent' : 'failed',
        deliveredChatIds: mergedDelivered,
        lastError: String(error?.message || 'unknown').slice(0, 500),
      },
      { merge: true },
    ).catch((e) => {
      logger.warn(`Could not record failed notification status for ${orderDocId}`, e);
    });
    logger.error(`Error sending Telegram notification for ${data.orderNumber}`, error);
    throw error;
  }

  const allDelivered = Array.from(new Set([...deliveredChatIds, ...newlyDelivered]));
  const sentPayload = {
    telegramSent: true,
    telegramStatus: 'sent',
    deliveredChatIds: allDelivered,
    sentAt: Timestamp.now(),
    lastError: null,
  };
  const persistBackoffMs = [0, 250, 500, 1000];
  let lastPersistErr: unknown = null;
  for (let attempt = 0; attempt < persistBackoffMs.length; attempt++) {
    if (persistBackoffMs[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, persistBackoffMs[attempt]));
    }
    try {
      await notifRef.set(sentPayload, { merge: true });
      lastPersistErr = null;
      break;
    } catch (err) {
      lastPersistErr = err;
    }
  }
  if (lastPersistErr !== null) {
    // Telegram delivery succeeded, but Firestore rejected every persist attempt.
    // Do not flip status to failed or rethrow into an immediate trigger retry;
    // log an error so it is observable (the reconciler will reclaim after TTL
    // if Firestore was down, preferring at-least-once over silent loss).
    logger.error(
      `Telegram notification sent for ${data.orderNumber} (${orderDocId}) but failed to persist sent state after ${persistBackoffMs.length} attempts`,
      { error: lastPersistErr },
    );
  }
  return { sent: true, alreadySent: false };
}

export const RECONCILE_LOOKBACK_MS = 2 * 60 * 60 * 1000;
export const RECONCILE_MIN_AGE_MS = 30_000;
export const RECONCILE_MAX_ATTEMPTS = 60;
// The scan filters already-sent docs *after* fetching, so this is the number of
// recent orders visible to a sweep, not the number it will retry. Keep it well
// above the busiest 2-hour window so unresolved orders are not starved by newer
// ones being returned first.
const RECONCILE_BATCH_LIMIT = 200;
const RECONCILE_CONCURRENCY = 5;

/** Runs work in bounded chunks so one slow send cannot stall the whole sweep. */
async function runBounded<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    // Each worker catches its own errors, so no send can reject the whole batch.
    results.push(...await Promise.all(chunk.map(work)));
  }
  return results;
}

function orderReadyTimeMs(data: Record<string, any>): number {
  const tsMs = typeof data.timestamp?.toMillis === 'function'
    ? data.timestamp.toMillis()
    : typeof data.timestamp?.toDate === 'function'
      ? data.timestamp.toDate().getTime()
      : NaN;
  const paidAtMs = typeof data.paidAt === 'string' ? Date.parse(data.paidAt) : NaN;
  if (Number.isFinite(paidAtMs) && (!Number.isFinite(tsMs) || paidAtMs > tsMs)) {
    return paidAtMs;
  }
  return Number.isFinite(tsMs) ? tsMs : 0;
}

/**
 * Safety-net reconciler: scans recent kitchen-visible orders that have not yet
 * been marked `telegramSent: true` in `order_notifications` and retries delivery.
 * Protects against Eventarc drops, >10m Telegram outages, or long 429 cooldowns.
 */
export async function reconcileMissedOrderNotifications(
  db: Firestore = getFirestore(),
  opts: {
    nowMs?: number;
    lookbackMs?: number;
    minAgeMs?: number;
    maxAttempts?: number;
    limit?: number;
    concurrency?: number;
    paidDocs?: FirebaseFirestore.QueryDocumentSnapshot[];
  } = {},
): Promise<{ checked: number; retried: number; sent: number; failed: number }> {
  if (!hasTelegramConfig()) {
    logger.warn('reconcileMissedOrderNotifications: Telegram config missing; skipping reconciliation');
    return { checked: 0, retried: 0, sent: 0, failed: 0 };
  }

  const nowMs = opts.nowMs ?? Date.now();
  const lookbackMs = opts.lookbackMs ?? RECONCILE_LOOKBACK_MS;
  const minAgeMs = opts.minAgeMs ?? RECONCILE_MIN_AGE_MS;
  const maxAttempts = opts.maxAttempts ?? RECONCILE_MAX_ATTEMPTS;
  const limit = opts.limit ?? RECONCILE_BATCH_LIMIT;
  const concurrency = Math.max(1, opts.concurrency ?? RECONCILE_CONCURRENCY);

  const cutoffMs = nowMs - lookbackMs;
  const [recentSnap, paidDocs] = await Promise.all([
    db.collection('orders')
      .where('timestamp', '>=', Timestamp.fromMillis(cutoffMs))
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get(),
    opts.paidDocs
      ? Promise.resolve(opts.paidDocs)
      : db.collection('orders')
          .where('paidAt', '>=', new Date(cutoffMs).toISOString())
          .orderBy('paidAt', 'desc')
          .limit(limit)
          .get()
          .then((snap) => snap.docs),
  ]);

  const seenDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const doc of recentSnap.docs) seenDocs.set(doc.id, doc);
  for (const doc of paidDocs) seenDocs.set(doc.id, doc);
  const docs = Array.from(seenDocs.values());

  const candidates = docs.filter((doc) => {
    const data = doc.data();
    if (!isOrderVisibleInKds(data)) return false;
    if (data.telegramSent === true) return false;
    const readyMs = orderReadyTimeMs(data);
    if (readyMs > 0 && nowMs - readyMs < minAgeMs) return false;
    return true;
  });

  if (candidates.length === 0) {
    return { checked: docs.length, retried: 0, sent: 0, failed: 0 };
  }

  const notifRefs = candidates.map((doc) =>
    db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc(doc.id),
  );
  const notifSnaps = await db.getAll(...notifRefs);

  const jobs = candidates.map((orderDoc, i) => ({
    orderDoc,
    notifData: notifSnaps[i].exists ? notifSnaps[i].data() : undefined,
  })).filter(({ orderDoc, notifData }) => {
    // A terminal order can still have a claimed-but-unsent notification when
    // staff completed it immediately. Retry that existing lease, but do not
    // create a brand-new notification for an order staff already closed out.
    const terminal = orderDoc.data().status === 'Cancelled' || orderDoc.data().status === 'Completed';
    if (terminal && !hasOrderNotificationState(notifData)) return false;
    if (notifData?.telegramSent === true) return false;
    if (notifData?.telegramStatus === 'failed_permanent') return false;
    const reconcileAttempts = typeof notifData?.reconcileAttempts === 'number' && Number.isFinite(notifData.reconcileAttempts)
      ? notifData.reconcileAttempts
      : 0;
    if (reconcileAttempts >= maxAttempts) {
      logger.warn(`Skipping Telegram reconciliation for ${orderDoc.id}: reached max reconcile attempts (${reconcileAttempts})`);
      return false;
    }
    return !(notifData && evaluateNotificationClaim(notifData, nowMs) === 'in-flight');
  });

  const outcomes = await runBounded(jobs, concurrency, async ({ orderDoc }) => {
    const orderData = orderDoc.data();
    try {
      const res = await notifyOrderOnce(orderDoc.id, orderData, '', { source: 'reconciler' });
      return { orderDocId: orderDoc.id, orderData, sent: res.sent, error: null as unknown };
    } catch (err) {
      return { orderDocId: orderDoc.id, orderData, sent: false, error: err };
    }
  });

  let sent = 0;
  let failed = 0;
  for (const outcome of outcomes) {
    const { orderDocId, orderData, sent: wasSent, error } = outcome;
    if (error) {
      failed++;
      logger.error(`Reconciliation retry failed for order ${orderData.orderId || orderDocId}`, error);
    } else if (wasSent) {
      sent++;
      logger.warn(`Reconciled missed Telegram notification for order ${orderData.orderId || orderDocId}`, {
        orderDocId,
      });
    }
  }

  return { checked: docs.length, retried: jobs.length, sent, failed };
}

/**
 * Payment confirmations (and cancelled-order refund reviews) are triggered by a
 * one-time PAID transition. If Telegram delivery succeeds but the sent-state
 * write fails — or the event ages past the retry window — nothing re-drives it.
 * This pass reclaims those orders from the same `paidAt` scan the order scan
 * already uses, with its own attempt counter so it cannot starve new orders.
 */
export async function reconcileMissedPaymentNotifications(
  db: Firestore = getFirestore(),
  opts: {
    nowMs?: number;
    lookbackMs?: number;
    minAgeMs?: number;
    maxAttempts?: number;
    limit?: number;
    concurrency?: number;
    paidDocs?: FirebaseFirestore.QueryDocumentSnapshot[];
  } = {},
): Promise<{ checked: number; retried: number; sent: number; failed: number }> {
  if (!hasTelegramConfig()) {
    logger.warn('reconcileMissedPaymentNotifications: Telegram config missing; skipping');
    return { checked: 0, retried: 0, sent: 0, failed: 0 };
  }

  const nowMs = opts.nowMs ?? Date.now();
  const lookbackMs = opts.lookbackMs ?? RECONCILE_LOOKBACK_MS;
  const minAgeMs = opts.minAgeMs ?? RECONCILE_MIN_AGE_MS;
  const maxAttempts = opts.maxAttempts ?? RECONCILE_MAX_ATTEMPTS;
  const limit = opts.limit ?? RECONCILE_BATCH_LIMIT;
  const concurrency = Math.max(1, opts.concurrency ?? RECONCILE_CONCURRENCY);
  const cutoff = new Date(nowMs - lookbackMs).toISOString();

  const paidDocs = opts.paidDocs ?? (await db.collection('orders')
    .where('paidAt', '>=', cutoff)
    .orderBy('paidAt', 'desc')
    .limit(limit)
    .get()).docs;

  const docs = paidDocs.filter((doc) => {
    const data = doc.data();
    if (String(data.paymentMethod || '').toLowerCase() !== 'gcash' || data.paymentStatus !== 'PAID') {
      return false;
    }
    const paidAtMs = typeof data.paidAt === 'string' ? Date.parse(data.paidAt) : NaN;
    if (Number.isFinite(paidAtMs) && nowMs - paidAtMs < minAgeMs) return false;
    return true;
  });
  if (docs.length === 0) {
    return { checked: 0, retried: 0, sent: 0, failed: 0 };
  }

  const notifSnaps = await db.getAll(...docs.map((doc) =>
    db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc(doc.id),
  ));
  const jobs = docs.map((orderDoc, i) => {
    const notifData = notifSnaps[i].exists ? notifSnaps[i].data() : undefined;
    const attempts = typeof notifData?.paymentReconcileAttempts === 'number' &&
      Number.isFinite(notifData.paymentReconcileAttempts)
      ? notifData.paymentReconcileAttempts
      : 0;
    return { orderDoc, notifData, priorAttempts: attempts };
  }).filter(({ orderDoc, notifData, priorAttempts }) => {
    const status = evaluatePaymentNotificationClaim(notifData, nowMs);
    if (status !== 'claimed' && status !== 'missing') return false;
    if (priorAttempts >= maxAttempts) {
      logger.warn(`Skipping payment reconciliation for ${orderDoc.id}: reached max attempts (${priorAttempts})`);
      return false;
    }
    return true;
  });

  const outcomes = await runBounded(jobs, concurrency, async ({ orderDoc, priorAttempts }) => {
    const orderData = orderDoc.data();
    try {
      const res = await notifyPaymentConfirmedOnce(orderDoc.id, orderData, { db, source: 'reconciler' });
      return { orderDocId: orderDoc.id, orderData, priorAttempts, sent: res.sent, error: null as unknown };
    } catch (err) {
      return { orderDocId: orderDoc.id, orderData, priorAttempts, sent: false, error: err };
    }
  });

  let sent = 0;
  let failed = 0;
  for (const outcome of outcomes) {
    const { orderDocId, orderData, priorAttempts, sent: wasSent, error } = outcome;
    if (error) {
      failed++;
      logger.error(`Payment reconciliation failed for order ${orderData.orderId || orderDocId}`, error);
    } else if (wasSent) {
      sent++;
      logger.warn(`Reconciled missed payment notification for order ${orderData.orderId || orderDocId}`, {
        orderDocId,
        priorReconcileAttempts: priorAttempts,
      });
    }
  }

  return { checked: docs.length, retried: jobs.length, sent, failed };
}

export const reconcileOrderNotifications = onSchedule(
  {
    schedule: 'every 2 minutes',
    timeZone: 'Asia/Manila',
    memory: '256MiB',
    timeoutSeconds: 540,
    // A long sweep must not overlap the next 2-minute run while a claim is live.
    maxInstances: 1,
    secrets: [telegramToken, telegramChatIds, googleMapsApiKey],
  },
  async () => {
    if (!hasTelegramConfig()) {
      logger.warn('reconcileOrderNotifications: Telegram config missing; skipping reconciliation');
      return;
    }
    const db = getFirestore();
    const nowMs = Date.now();
    const paidSnap = await db.collection('orders')
      .where('paidAt', '>=', new Date(nowMs - RECONCILE_LOOKBACK_MS).toISOString())
      .orderBy('paidAt', 'desc')
      .limit(RECONCILE_BATCH_LIMIT)
      .get();
    const [orders, payments] = await Promise.all([
      reconcileMissedOrderNotifications(db, { nowMs, paidDocs: paidSnap.docs }),
      reconcileMissedPaymentNotifications(db, { nowMs, paidDocs: paidSnap.docs }),
    ]);
    if (orders.retried > 0) logger.info('Order notification reconciliation completed', orders);
    if (payments.retried > 0) logger.info('Payment notification reconciliation completed', payments);
  },
);

// Legacy/public kiosk endpoint: reads strictly from the Firestore order doc and
// deduplicates atomically with onOrderWritten.
export const sendOrderNotification = onCall(
  { secrets: [telegramToken, telegramChatIds, googleMapsApiKey] },
  async (request) => {
    const role = (request.auth?.token as any)?.role;
    const isStaff = !!request.auth?.uid && (role === 'staff' || role === 'admin');
    const clientIp = clientIpFromRequest(request.rawRequest) || 'unknown';
    if (!isStaff) {
      await enforceFixedWindowRateLimit(
        `notif:send:${clientIp}`,
        NOTIF_RATE_MAX,
        NOTIF_RATE_WINDOW_MS,
        'Too many notification requests. Please try again shortly.',
      );
    }

    const d = request.data || {};
    const orderDocId =
      typeof d.orderDocId === 'string' && ALNUM_DOC_ID.test(d.orderDocId) ? d.orderDocId : null;
    if (!orderDocId) {
      throw new HttpsError('invalid-argument', 'Missing orderDocId');
    }
    const orderNumber = cleanStr(d.orderNumber, 32, 'orderNumber');

    const orderSnap = await getFirestore().collection('orders').doc(orderDocId).get();
    if (!orderSnap.exists) {
      throw new HttpsError('not-found', 'Order not found');
    }
    const orderData = orderSnap.data()!;
    if (orderData.orderId !== orderNumber) {
      throw new HttpsError('permission-denied', 'Order reference mismatch');
    }
    if (!isOrderVisibleInKds(orderData) || orderData.status === 'Cancelled') {
      throw new HttpsError('failed-precondition', 'Order is not eligible for kitchen notification');
    }

    try {
      // Ignore caller-supplied timeStr; derive strictly from the stored order timestamp.
      const result = await notifyOrderOnce(orderDocId, orderData, '', { forceRetry: isStaff });
      if (result.permanentFailure) {
        throw new HttpsError('failed-precondition', 'Telegram notification failed permanently');
      }
      if (result.inFlight) {
        return { success: true, inFlight: true };
      }
      return result.alreadySent ? { success: true, alreadySent: true } : { success: true };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', 'Failed to send Telegram notification');
    }
  });
