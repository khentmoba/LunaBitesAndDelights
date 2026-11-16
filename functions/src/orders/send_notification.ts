import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { sendToAll, sendPhotoToAll, escapeMd } from '../telegram_api';
import { telegramToken, telegramChatIds, googleMapsApiKey } from '../secrets';
import { logger } from 'firebase-functions';
import { ALNUM_DOC_ID, cleanStr, optStr, cleanInt } from '../util/security';

const ORDER_TYPES = ['Walk-In', 'Pickup', 'Delivery'];
const MAX_ITEMS = 50;

/** Records notification outcome on the order. Never fails the request. */
async function markNotified(orderDocId: string | null, sent: boolean) {
  if (!orderDocId) return;
  try {
    await getFirestore().collection('orders').doc(orderDocId)
      .set({ telegramSent: sent }, { merge: true });
  } catch (error: any) {
    logger.warn(`Could not record notification status for ${orderDocId}`, error);
  }
}

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

function parseOrderNotificationInput(d: any): {
  orderDocId: string | null;
  data: OrderNotificationData;
} {
  const orderDocId =
    typeof d.orderDocId === 'string' && ALNUM_DOC_ID.test(d.orderDocId) ? d.orderDocId : null;
  const orderNumber = cleanStr(d.orderNumber, 32, 'orderNumber');
  const customerName = cleanStr(d.customerName, 100, 'customerName');
  const customerAddress = optStr(d.customerAddress);
  const customerPhone = optStr(d.customerPhone, 32);
  const total = cleanInt(d.total, 1000000, 'total');
  const timeStr = optStr(d.timeStr, 64);
  const orderType = ORDER_TYPES.includes(d.orderType) ? d.orderType : 'Pickup'; // #8
  const deliveryFee = cleanInt(d.deliveryFee ?? 0, 5000, 'deliveryFee');
  const paymentMethod = optStr(d.paymentMethod, 32);
  const paymentStatus = optStr(d.paymentStatus, 32);

  if (!Array.isArray(d.items) || d.items.length === 0 || d.items.length > MAX_ITEMS) {
    throw new HttpsError('invalid-argument', 'Invalid items');
  }
  const items = d.items.map((i: any) => ({
    name: cleanStr(i?.name, 120, 'item name'),
    variant: optStr(i?.variant, 120),
    price: cleanInt(i?.price, 100000, 'item price'),
    quantity: cleanInt(i?.quantity ?? 1, 99, 'item quantity') || 1,
  }));

  // Coordinates must be real numbers or omitted (no string injection into map URL).
  const lat = (typeof d.lat === 'number' && Math.abs(d.lat) <= 90) ? d.lat : null;
  const lng = (typeof d.lng === 'number' && Math.abs(d.lng) <= 180) ? d.lng : null;

  return {
    orderDocId,
    data: {
      orderNumber,
      customerName,
      customerAddress,
      customerPhone,
      items,
      total,
      timeStr,
      orderType,
      deliveryFee,
      paymentMethod,
      paymentStatus,
      lat,
      lng,
    },
  };
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

// Public kiosk endpoint: strict validation + sanitization instead of auth (#14).
export const sendOrderNotification = onCall(
  { secrets: [telegramToken, telegramChatIds, googleMapsApiKey] }, // #1: secrets server-side only
  async (request) => {
    const { orderDocId, data } = parseOrderNotificationInput(request.data || {});
    const message = formatOrderNotification(data);

    logger.info(`Sending order notification for ${data.orderNumber} to Telegram`);
    try {
      if (data.orderType === 'Delivery' && data.lat != null && data.lng != null) {
        await sendDeliveryNotification(data, message, data.lat, data.lng);
      } else {
        await sendToAll(message);
      }

      await markNotified(orderDocId, true);
      return { success: true };
    } catch (error: any) {
      await markNotified(orderDocId, false);
      logger.error(`Error sending Telegram notification for ${data.orderNumber}`, error);
      throw new HttpsError('internal', 'Failed to send Telegram notification');
    }
  });
