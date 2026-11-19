import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { sendToAll, sendPhotoToAll, escapeMd } from '../telegram_api';
import { telegramToken, telegramChatIds, googleMapsApiKey } from '../secrets';
import { logger } from 'firebase-functions';
import { ALNUM_DOC_ID, cleanStr, optStr } from '../util/security';

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

/** Concise summary caption for photos when the full receipt exceeds Telegram's 1024-char caption limit. */
export function formatDeliverySummaryCaption(data: OrderNotificationData): string {
  return [
    `🔔 *NEW DELIVERY — ${escapeMd(data.orderNumber)}*`,
    `🛵 *Type:* Delivery`,
    '',
    `👤 *Name:* ${escapeMd(data.customerName)}`,
    `📍 *Address:* ${escapeMd(data.customerAddress || '')}`,
    `📞 *Phone:* ${escapeMd(data.customerPhone || '')}`,
    '',
    `💰 *FOOD TOTAL:* ₱*${escapeMd(data.total.toString())}*`,
    `💳 *Payment:* ${escapeMd(data.paymentMethod || 'Cash')}  \\-  *${escapeMd(data.paymentStatus || 'NOT PAID')}*`,
    `🕐 *Time:* ${escapeMd(data.timeStr || '')}`,
    '',
    `📋 _Full itemized list sent below\\._`,
  ].join('\n');
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
        await sendToAll(message);
        return;
      }
    } catch (photoError: any) {
      logger.warn(`Photo delivery failed for ${data.orderNumber}, falling back to text`, photoError);
    }
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

/**
 * Atomically claims Telegram notification delivery for an order so concurrent
 * trigger + callable invocations never double-send, and always renders from
 * the authoritative Firestore order document.
 */
export async function notifyOrderOnce(
  orderDocId: string,
  orderData: Record<string, any>,
  timeStrOverride = '',
): Promise<{ sent: boolean; alreadySent: boolean }> {
  const db = getFirestore();
  const orderRef = db.collection('orders').doc(orderDocId);

  let claimed = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;
    const current = snap.data()!;
    if (current.telegramSent === true || current.telegramStatus === 'sending') return;
    claimed = true;
    tx.set(orderRef, { telegramStatus: 'sending' }, { merge: true });
  });

  if (!claimed) {
    return { sent: false, alreadySent: true };
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

    await orderRef.set({ telegramSent: true, telegramStatus: 'sent' }, { merge: true });
    return { sent: true, alreadySent: false };
  } catch (error: any) {
    await orderRef.set({ telegramSent: false, telegramStatus: 'failed' }, { merge: true }).catch((e) => {
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
    const d = request.data || {};
    const orderDocId =
      typeof d.orderDocId === 'string' && ALNUM_DOC_ID.test(d.orderDocId) ? d.orderDocId : null;
    if (!orderDocId) {
      throw new HttpsError('invalid-argument', 'Missing orderDocId');
    }
    const orderNumber = cleanStr(d.orderNumber, 32, 'orderNumber');
    const timeStr = optStr(d.timeStr, 64);

    const orderSnap = await getFirestore().collection('orders').doc(orderDocId).get();
    if (!orderSnap.exists) {
      throw new HttpsError('not-found', 'Order not found');
    }
    const orderData = orderSnap.data()!;
    if (orderData.orderId !== orderNumber) {
      throw new HttpsError('permission-denied', 'Order reference mismatch');
    }

    try {
      const result = await notifyOrderOnce(orderDocId, orderData, timeStr);
      return result.alreadySent ? { success: true, alreadySent: true } : { success: true };
    } catch {
      throw new HttpsError('internal', 'Failed to send Telegram notification');
    }
  });
