import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { requireStaff, validDocId, cleanStr } from '../util/security';

const VALID_STATUSES = ['Pending', 'Preparing', 'Ready', 'Completed', 'Cancelled'];

// #17: trimmed projection — only what the KDS screen renders. Never ...data.
const projectOrder = (id: string, d: FirebaseFirestore.DocumentData) => ({
  id,
  orderNumber: d.orderId || d.orderNumber || id,
  customerName: d.customerName || '',
  customerPhone: d.customerPhone || '',
  customerAddress: d.customerAddress || '',
  lat: typeof d.lat === 'number' ? d.lat : null,
  lng: typeof d.lng === 'number' ? d.lng : null,
  deliveryFee: Number(d.deliveryFee) || 0,
  paymentMethod: String(d.paymentMethod || 'Cash'),
  paymentStatus: String(d.paymentStatus || 'NOT PAID'),
  entryType: String(d.entryType || ''),
  items: (Array.isArray(d.items) ? d.items : []).map((i: any) => ({
    name: String(i.name || ''),
    variant: String(i.variant || ''),
    qty: Number(i.quantity) || Number(i.qty) || 0,
    quantity: Number(i.quantity) || Number(i.qty) || 0,
    price: Number(i.price) || 0,
  })),
  itemsCount: Array.isArray(d.items)
    ? d.items.reduce((s: number, i: any) => s + (Number(i.quantity) || Number(i.qty) || 0), 0)
    : 0,
  total: Number(d.totalAmount) || 0,
  type: String(d.type || ''),
  status: String(d.status || 'Pending'),
  timestamp: d.timestamp?.toDate?.()?.toISOString?.() || (typeof d.timestamp === 'string' ? d.timestamp : new Date().toISOString()),
});

export const getActiveOrders = onCall(async (request) => {
  requireStaff(request); // #6 + #7
  const db = getFirestore();
  const includeCompleted = request.data?.includeCompleted === true;
  try {
    // 7-day lookback so yesterday's active and history orders are never cut off
    const lookbackThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const snapshot = await db.collection('orders')
      .where('timestamp', '>=', lookbackThreshold)
      .orderBy('timestamp', 'desc')
      .limit(200)
      .get();

    const orders = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const status = data.status || 'Pending';
      if (includeCompleted || (status !== 'Completed' && status !== 'Cancelled')) {
        orders.push(projectOrder(doc.id, data));
      }
    }
    return { success: true, orders };
  } catch (error: any) {
    logger.error('Error fetching active orders:', error);
    throw new HttpsError('internal', 'Failed to fetch active orders');
  }
});

export const updateOrderStatus = onCall(async (request) => {
  requireStaff(request); // #6 + #7
  const orderId = validDocId(request.data?.orderId, 'orderId'); // #13
  const status = cleanStr(request.data?.status, 32, 'status'); // #14
  if (!VALID_STATUSES.includes(status)) throw new HttpsError('invalid-argument', 'Invalid status'); // #8

  const db = getFirestore();
  try {
    const orderRef = db.collection('orders').doc(orderId);
    if (!(await orderRef.get()).exists) throw new HttpsError('not-found', 'Order not found');
    await orderRef.update({ status });
    logger.info(`Order ${orderId} status updated to ${status}`);
    return { success: true };
  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    logger.error(`Error updating order ${orderId} status:`, error);
    throw new HttpsError('internal', 'Failed to update order status');
  }
});
