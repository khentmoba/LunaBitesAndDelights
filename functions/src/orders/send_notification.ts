import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { sendToAll, sendPhotoToAll, escapeMd } from '../telegram_api';
import { telegramToken, telegramChatIds, googleMapsApiKey } from '../secrets';
import { logger } from 'firebase-functions';
import { ALNUM_DOC_ID, cleanStr, clientIpFromRequest, enforceFixedWindowRateLimit } from '../util/security';
import { isOrderVisibleInKds } from './kds';

const NOTIF_RATE_WINDOW_MS = 10 * 60 * 1000;
const NOTIF_RATE_MAX = 20;
const ORDER_NOTIF_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ORDER_TYPES = ['Walk-In', 'Pickup', 'Delivery'];
const MAX_ITEMS = 50;

export const itemLines = (items: any[]): string =>
  items
    .map((i: any) => {
      const variantText = i.variant?.length > 0 ? ` \\(${escapeMd(i.variant)}\\)` : '';
      return `  • ${i.quantity}x ${escapeMd(i.name)}${variantText} — ₱${escapeMd((i.price * i.quantity).toString())}`;
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
  return `https://api.maptiler.com/maps/streets-v2/static/${lng},${lat},17/600x400@2x.png?key=${apiKey}&markers=${lng},${lat}`;
}

/** Universal Google Maps navigation URL for turn-by-turn directions. */
export function getGoogleMapsNavigationUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

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
    const arrayBuffer = await res.arrayBuffer();
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
    gmapKey = googleMapsApiKey.value();
  } catch {
    gmapKey = '';
  }
  gmapKey ||= process.env.GOOGLE_MAPS_API_KEY || '';
  if (gmapKey) return getGoogleStaticMapUrl(lat, lng, gmapKey);
  const maptilerKey = process.env.MAPTILER_KEY || '';
  return maptilerKey ? getMapTilerStaticMapUrl(lat, lng, maptilerKey) : null;
}

async function sendDeliveryNotification(
  data: OrderNotificationData,
  message: string,
  lat: number,
  lng: number,
): Promise<void> {
  const replyMarkup = {
    inline_keyboard: [[{ text: '📍 Open in Google Maps 🧭', url: getGoogleMapsNavigationUrl(lat, lng) }]],
  };
  const mapUrl = resolveStaticMapUrl(lat, lng);
  let sentSplitPhoto = false;
  if (mapUrl) {
    try {
      const imageBuffer = await fetchMapImage(mapUrl);
      if (imageBuffer) {
        if (message.length <= 1024) {
          await sendPhotoToAll(imageBuffer, message, { reply_markup: replyMarkup });
          return;
        }
        const summaryCaption = formatDeliverySummaryCaption(data);
        await sendPhotoToAll(imageBuffer, summaryCaption, { reply_markup: replyMarkup });
        sentSplitPhoto = true;
      }
    } catch (photoError: any) {
      logger.warn(`Photo delivery failed for ${data.orderNumber}, falling back to text`, photoError);
    }
  }
  if (sentSplitPhoto) {
    await sendToAll(message);
    return;
  }
  await sendToAll(message, { reply_markup: replyMarkup });
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

export type ClaimStatus = 'claimed' | 'already-sent' | 'in-flight' | 'missing';

/** Evaluates whether a notification can be claimed, was already sent, or is actively in-flight within TTL. */
export function evaluateNotificationClaim(
  current: Record<string, any> | undefined,
  nowMs = Date.now(),
): ClaimStatus {
  if (!current) return 'missing';
  if (current.telegramSent === true) return 'already-sent';
  if (current.telegramStatus === 'sending') {
    const claimedAt = current.telegramClaimedAt;
    if (typeof claimedAt === 'number' && Number.isFinite(claimedAt) && nowMs - claimedAt < TELEGRAM_CLAIM_TTL_MS) {
      return 'in-flight';
    }
  }
  return 'claimed';
}

/** Returns true if a notification can be claimed (not sent, and not actively claimed within TTL). */
export function canClaimNotification(current: Record<string, any> | undefined, nowMs = Date.now()): boolean {
  return evaluateNotificationClaim(current, nowMs) === 'claimed';
}

export const ORDER_NOTIFICATIONS_COLLECTION = 'order_notifications';

/**
 * Atomically claims Telegram notification delivery for an order in a separate
 * `order_notifications/{orderDocId}` collection so concurrent trigger + callable
 * invocations never double-send and claiming does not re-trigger `onOrderWritten`.
 */
export async function notifyOrderOnce(
  orderDocId: string,
  orderData: Record<string, any>,
  timeStrOverride = '',
): Promise<{ sent: boolean; alreadySent: boolean; inFlight?: boolean }> {
  if (orderData.telegramSent === true) {
    return { sent: false, alreadySent: true, inFlight: false };
  }

  const db = getFirestore();
  const notifRef = db.collection(ORDER_NOTIFICATIONS_COLLECTION).doc(orderDocId);

  const nowMs = Date.now();
  const expireAt = Timestamp.fromMillis(nowMs + ORDER_NOTIF_TTL_MS);
  const claimStatus = await db.runTransaction<ClaimStatus>(async (tx) => {
    const snap = await tx.get(notifRef);
    const status = evaluateNotificationClaim(snap.exists ? snap.data() : {}, nowMs);
    if (status === 'claimed') {
      tx.set(notifRef, { telegramStatus: 'sending', telegramClaimedAt: nowMs, expireAt }, { merge: true });
    }
    return status;
  });

  if (claimStatus === 'in-flight') {
    return { sent: false, alreadySent: false, inFlight: true };
  }
  if (claimStatus !== 'claimed') {
    return { sent: false, alreadySent: true, inFlight: false };
  }

  const data = notificationDataFromOrder(orderData, orderDocId, timeStrOverride);
  const message = formatOrderNotification(data);

  logger.info(`Sending order notification for ${data.orderNumber} to Telegram`);
  try {
    if (data.orderType === 'Delivery' && data.lat != null && data.lng != null) {
      await sendDeliveryNotification(data, message, data.lat, data.lng);
    } else {
      await sendToAll(message);
    }

    await notifRef.set({ telegramSent: true, telegramStatus: 'sent' }, { merge: true });
    return { sent: true, alreadySent: false };
  } catch (error: any) {
    await notifRef.set({ telegramSent: false, telegramStatus: 'failed' }, { merge: true }).catch((e) => {
      logger.warn(`Could not record failed notification status for ${orderDocId}`, e);
    });
    logger.error(`Error sending Telegram notification for ${data.orderNumber}`, error);
    throw error;
  }
}

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
      const result = await notifyOrderOnce(orderDocId, orderData);
      return result.alreadySent ? { success: true, alreadySent: true } : { success: true };
    } catch {
      throw new HttpsError('internal', 'Failed to send Telegram notification');
    }
  });
