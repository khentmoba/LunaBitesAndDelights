import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import * as crypto from 'crypto';
import { phtDateLabel } from '../util';
import { cleanStr, optStr } from '../util/security';
import { validateAndPriceItems } from '../payments/create_checkout';

const ORDER_TYPES = new Set(['Pickup', 'Delivery', 'Walk-In']);
const PAYMENT_METHODS = new Set(['Cash', 'GCash']);
const ORDER_ID_RE = /^[A-Za-z0-9_-]{4,32}$/;

function serverOrderNumber(at = new Date()): string {
  const pht = new Date(at.getTime() + 8 * 3600_000);
  const two = (n: number) => String(n).padStart(2, '0');
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase().slice(0, 3);
  return `LU-${two(pht.getUTCFullYear() % 100)}${two(pht.getUTCMonth() + 1)}${two(pht.getUTCDate())}-${two(pht.getUTCHours())}${two(pht.getUTCMinutes())}${two(pht.getUTCSeconds())}-${suffix}`;
}

/**
 * Server-validated order creation callable. Re-prices every item from
 * MENU_PRICES / VARIANT_PRICES and assigns totalAmount, dateLabel, timestamp,
 * status, paymentStatus, and entryType server-side.
 */
export const placeOrder = onCall(async (request) => {
  const d = request.data || {};
  const role = (request.auth?.token as any)?.role;
  const isStaff = !!request.auth?.uid && (role === 'staff' || role === 'admin');

  const type = cleanStr(d.type, 16, 'type');
  if (!ORDER_TYPES.has(type)) {
    throw new HttpsError('invalid-argument', 'Invalid order type');
  }
  if (type === 'Walk-In' && !isStaff) {
    throw new HttpsError('permission-denied', 'Staff access required for walk-in orders');
  }

  const paymentMethod = cleanStr(d.paymentMethod, 16, 'paymentMethod');
  if (!PAYMENT_METHODS.has(paymentMethod)) {
    throw new HttpsError('invalid-argument', 'Invalid payment method');
  }

  const customerName = cleanStr(d.customerName, 100, 'customerName');
  const customerPhone = optStr(d.customerPhone, 32);
  const customerAddress = optStr(d.customerAddress, 300);

  if (!isStaff && type === 'Delivery' && customerAddress.length === 0) {
    throw new HttpsError('invalid-argument', 'Delivery address is required');
  }

  const lat = typeof d.lat === 'number' && Number.isFinite(d.lat) && Math.abs(d.lat) <= 90 ? d.lat : null;
  const lng = typeof d.lng === 'number' && Number.isFinite(d.lng) && Math.abs(d.lng) <= 180 ? d.lng : null;
  const totalDistance =
    typeof d.totalDistance === 'number' && Number.isFinite(d.totalDistance) && d.totalDistance >= 0 && d.totalDistance <= 500
      ? d.totalDistance
      : 0;

  const { items, total: totalAmount } = validateAndPriceItems(d.items);

  const rawOrderId = typeof d.orderId === 'string' ? d.orderId.trim() : '';
  const orderId = rawOrderId && ORDER_ID_RE.test(rawOrderId) ? rawOrderId : serverOrderNumber();

  const status = 'Pending';
  const entryType = isStaff ? 'Staff' : 'Kiosk';
  const paymentStatus = isStaff
    ? 'PAID'
    : paymentMethod === 'GCash'
      ? 'AWAITING_PAYMENT'
      : 'NOT PAID';

  const db = getFirestore();
  const ref = db.collection('orders').doc();
  await ref.set({
    orderId,
    items,
    totalAmount,
    timestamp: FieldValue.serverTimestamp(),
    dateLabel: phtDateLabel(),
    type,
    entryType,
    customerName,
    customerPhone,
    customerAddress: type === 'Delivery' ? customerAddress : type,
    lat: type === 'Delivery' ? lat : null,
    lng: type === 'Delivery' ? lng : null,
    deliveryFee: 0,
    totalDistance: type === 'Delivery' ? totalDistance : 0,
    paymentMethod,
    paymentStatus,
    status,
    checkoutSessionId: null,
    paymongoPaymentId: null,
  });

  logger.info(`Order ${orderId} (${ref.id}) placed via callable [${entryType}/${type}/${paymentMethod}]`);
  return { success: true, docId: ref.id, orderId, totalAmount };
});
