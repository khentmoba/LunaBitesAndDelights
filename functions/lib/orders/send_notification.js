"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendOrderNotification = exports.itemLines = void 0;
exports.formatOrderNotification = formatOrderNotification;
exports.formatDeliverySummaryCaption = formatDeliverySummaryCaption;
exports.getGoogleStaticMapUrl = getGoogleStaticMapUrl;
exports.getMapTilerStaticMapUrl = getMapTilerStaticMapUrl;
exports.getGoogleMapsNavigationUrl = getGoogleMapsNavigationUrl;
exports.fetchMapImage = fetchMapImage;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const telegram_api_1 = require("../telegram_api");
const secrets_1 = require("../secrets");
const firebase_functions_1 = require("firebase-functions");
const security_1 = require("../util/security");
const ORDER_TYPES = ['Walk-In', 'Pickup', 'Delivery'];
const MAX_ITEMS = 50;
/** Records notification outcome on the order. Never fails the request. */
async function markNotified(orderDocId, sent) {
    if (!orderDocId)
        return;
    try {
        await (0, firestore_1.getFirestore)().collection('orders').doc(orderDocId)
            .set({ telegramSent: sent }, { merge: true });
    }
    catch (error) {
        firebase_functions_1.logger.warn(`Could not record notification status for ${orderDocId}`, error);
    }
}
const itemLines = (items) => items
    .map((i) => {
    const variantText = i.variant?.length > 0 ? ` \\(${(0, telegram_api_1.escapeMd)(i.variant)}\\)` : '';
    return `  • ${i.quantity}x ${(0, telegram_api_1.escapeMd)(i.name)}${variantText} — ₱${(0, telegram_api_1.escapeMd)((i.price * i.quantity).toString())}`;
})
    .join('\n');
exports.itemLines = itemLines;
function formatOrderNotification(data) {
    const isWalkIn = data.orderType === 'Walk-In';
    const isPickup = data.orderType === 'Pickup';
    const lines = (0, exports.itemLines)(data.items);
    return isWalkIn
        ? [
            `🔔 *WALK\\-IN ORDER — ${(0, telegram_api_1.escapeMd)(data.orderNumber)}*`,
            `🏪 *Type:* Walk\\-In  \\[STAFF ENTRY\\]`,
            '',
            `👤 *Name:* ${(0, telegram_api_1.escapeMd)(data.customerName)}`,
            `📞 *Phone:* ${(0, telegram_api_1.escapeMd)(data.customerPhone || '')}`,
            '',
            `🛒 *Items:*`,
            lines,
            '',
            `💳 *Payment:* ${(0, telegram_api_1.escapeMd)(data.paymentMethod || 'Cash')}  \\-  ✅ *${(0, telegram_api_1.escapeMd)(data.paymentStatus || 'PAID')}*`,
            '',
            `💰 *TOTAL:* ₱*${(0, telegram_api_1.escapeMd)(data.total.toString())}*`,
            `🕐 *Time:* ${(0, telegram_api_1.escapeMd)(data.timeStr || '')}`,
            '',
            `✅ _Walk\\-in complete — paid at POS\\._`
        ].join('\n')
        : [
            `🔔 *NEW ORDER — ${(0, telegram_api_1.escapeMd)(data.orderNumber)}*`,
            `${isPickup ? '🏪' : '🛵'} *Type:* ${(0, telegram_api_1.escapeMd)(data.orderType || '')}`,
            '',
            `👤 *Name:* ${(0, telegram_api_1.escapeMd)(data.customerName)}`,
            ...(isPickup ? [] : [`📍 *Address:* ${(0, telegram_api_1.escapeMd)(data.customerAddress || '')}`]),
            ...(!isPickup && data.lat != null && data.lng != null
                ? [`🗺 [Get Directions on Google Maps](${getGoogleMapsNavigationUrl(data.lat, data.lng)})`]
                : []),
            `📞 *Phone:* ${(0, telegram_api_1.escapeMd)(data.customerPhone || '')}`,
            '',
            `🛒 *Items:*`,
            lines,
            '',
            ...(isPickup ? [] : ['🚚 *Delivery Fee:* Confirmed by rider; charged separately']),
            `💳 *Payment Method:* ${(0, telegram_api_1.escapeMd)(data.paymentMethod || 'Cash')}`,
            `📝 *Payment Status:* ${(0, telegram_api_1.escapeMd)(data.paymentStatus || 'NOT PAID')}${data.paymentStatus === 'AWAITING_PAYMENT' ? ' \\(GCash\\)' : ''}`,
            '',
            `💰 *${isPickup ? 'TOTAL' : 'FOOD TOTAL'}:* ₱*${(0, telegram_api_1.escapeMd)(data.total.toString())}*`,
            `🕐 *Time:* ${(0, telegram_api_1.escapeMd)(data.timeStr || '')}`,
            '',
            `✅ _Please prepare this order\\!_`
        ].join('\n');
}
/** Concise summary caption for photos when the full receipt exceeds Telegram's 1024-char caption limit. */
function formatDeliverySummaryCaption(data) {
    return [
        `🔔 *NEW DELIVERY — ${(0, telegram_api_1.escapeMd)(data.orderNumber)}*`,
        `🛵 *Type:* Delivery`,
        '',
        `👤 *Name:* ${(0, telegram_api_1.escapeMd)(data.customerName)}`,
        `📍 *Address:* ${(0, telegram_api_1.escapeMd)(data.customerAddress || '')}`,
        `📞 *Phone:* ${(0, telegram_api_1.escapeMd)(data.customerPhone || '')}`,
        '',
        `💰 *FOOD TOTAL:* ₱*${(0, telegram_api_1.escapeMd)(data.total.toString())}*`,
        `💳 *Payment:* ${(0, telegram_api_1.escapeMd)(data.paymentMethod || 'Cash')}  \\-  *${(0, telegram_api_1.escapeMd)(data.paymentStatus || 'NOT PAID')}*`,
        `🕐 *Time:* ${(0, telegram_api_1.escapeMd)(data.timeStr || '')}`,
        '',
        `📋 _Full itemized list sent below\\._`,
    ].join('\n');
}
/** Generates Google Static Maps URL in hybrid mode (satellite imagery + road names). */
function getGoogleStaticMapUrl(lat, lng, apiKey) {
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
function getMapTilerStaticMapUrl(lat, lng, apiKey) {
    return `https://api.maptiler.com/maps/streets-v2/static/${lng},${lat},17/600x400@2x.png?key=${apiKey}&markers=${lng},${lat}`;
}
/** Universal Google Maps navigation URL for turn-by-turn directions. */
function getGoogleMapsNavigationUrl(lat, lng) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
/** Safely fetches a static map image buffer with an abort timeout. Returns null on failure. */
async function fetchMapImage(url, timeoutMs = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            firebase_functions_1.logger.warn(`Static map fetch failed: status ${res.status} (${res.statusText})`);
            return null;
        }
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }
    catch (err) {
        firebase_functions_1.logger.warn('Error fetching static map image', err);
        return null;
    }
    finally {
        clearTimeout(timer);
    }
}
function parseOrderNotificationInput(d) {
    const orderDocId = typeof d.orderDocId === 'string' && security_1.ALNUM_DOC_ID.test(d.orderDocId) ? d.orderDocId : null;
    const orderNumber = (0, security_1.cleanStr)(d.orderNumber, 32, 'orderNumber');
    const customerName = (0, security_1.cleanStr)(d.customerName, 100, 'customerName');
    const customerAddress = (0, security_1.optStr)(d.customerAddress);
    const customerPhone = (0, security_1.optStr)(d.customerPhone, 32);
    const total = (0, security_1.cleanInt)(d.total, 1000000, 'total');
    const timeStr = (0, security_1.optStr)(d.timeStr, 64);
    const orderType = ORDER_TYPES.includes(d.orderType) ? d.orderType : 'Pickup'; // #8
    const deliveryFee = (0, security_1.cleanInt)(d.deliveryFee ?? 0, 5000, 'deliveryFee');
    const paymentMethod = (0, security_1.optStr)(d.paymentMethod, 32);
    const paymentStatus = (0, security_1.optStr)(d.paymentStatus, 32);
    if (!Array.isArray(d.items) || d.items.length === 0 || d.items.length > MAX_ITEMS) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid items');
    }
    const items = d.items.map((i) => ({
        name: (0, security_1.cleanStr)(i?.name, 120, 'item name'),
        variant: (0, security_1.optStr)(i?.variant, 120),
        price: (0, security_1.cleanInt)(i?.price, 100000, 'item price'),
        quantity: (0, security_1.cleanInt)(i?.quantity ?? 1, 99, 'item quantity') || 1,
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
function resolveStaticMapUrl(lat, lng) {
    let gmapKey = '';
    try {
        gmapKey = secrets_1.googleMapsApiKey.value();
    }
    catch {
        gmapKey = '';
    }
    gmapKey || (gmapKey = process.env.GOOGLE_MAPS_API_KEY || '');
    if (gmapKey)
        return getGoogleStaticMapUrl(lat, lng, gmapKey);
    const maptilerKey = process.env.MAPTILER_KEY || '';
    return maptilerKey ? getMapTilerStaticMapUrl(lat, lng, maptilerKey) : null;
}
async function sendDeliveryNotification(data, message, lat, lng) {
    const replyMarkup = {
        inline_keyboard: [[{ text: '📍 Open in Google Maps 🧭', url: getGoogleMapsNavigationUrl(lat, lng) }]],
    };
    const mapUrl = resolveStaticMapUrl(lat, lng);
    if (mapUrl) {
        try {
            const imageBuffer = await fetchMapImage(mapUrl);
            if (imageBuffer) {
                if (message.length <= 1024) {
                    await (0, telegram_api_1.sendPhotoToAll)(imageBuffer, message, { reply_markup: replyMarkup });
                    return;
                }
                const summaryCaption = formatDeliverySummaryCaption(data);
                await (0, telegram_api_1.sendPhotoToAll)(imageBuffer, summaryCaption, { reply_markup: replyMarkup });
                await (0, telegram_api_1.sendToAll)(message);
                return;
            }
        }
        catch (photoError) {
            firebase_functions_1.logger.warn(`Photo delivery failed for ${data.orderNumber}, falling back to text`, photoError);
        }
    }
    await (0, telegram_api_1.sendToAll)(message, { reply_markup: replyMarkup });
}
// Public kiosk endpoint: strict validation + order-doc verification instead of auth (#14).
exports.sendOrderNotification = (0, https_1.onCall)({ secrets: [secrets_1.telegramToken, secrets_1.telegramChatIds, secrets_1.googleMapsApiKey] }, // #1: secrets server-side only
async (request) => {
    const { orderDocId, data } = parseOrderNotificationInput(request.data || {});
    if (!orderDocId) {
        throw new https_1.HttpsError('invalid-argument', 'Missing orderDocId');
    }
    const orderSnap = await (0, firestore_1.getFirestore)().collection('orders').doc(orderDocId).get();
    if (!orderSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Order not found');
    }
    const orderData = orderSnap.data();
    if (orderData.orderId !== data.orderNumber) {
        throw new https_1.HttpsError('permission-denied', 'Order reference mismatch');
    }
    if (orderData.telegramSent === true) {
        return { success: true, alreadySent: true };
    }
    const message = formatOrderNotification(data);
    firebase_functions_1.logger.info(`Sending order notification for ${data.orderNumber} to Telegram`);
    try {
        if (data.orderType === 'Delivery' && data.lat != null && data.lng != null) {
            await sendDeliveryNotification(data, message, data.lat, data.lng);
        }
        else {
            await (0, telegram_api_1.sendToAll)(message);
        }
        await markNotified(orderDocId, true);
        return { success: true };
    }
    catch (error) {
        await markNotified(orderDocId, false);
        firebase_functions_1.logger.error(`Error sending Telegram notification for ${data.orderNumber}`, error);
        throw new https_1.HttpsError('internal', 'Failed to send Telegram notification');
    }
});
//# sourceMappingURL=send_notification.js.map