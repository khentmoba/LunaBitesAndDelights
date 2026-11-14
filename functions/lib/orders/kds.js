"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateOrderStatus = exports.getActiveOrders = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const firebase_functions_1 = require("firebase-functions");
const security_1 = require("../util/security");
const VALID_STATUSES = ['Pending', 'Preparing', 'Ready', 'Completed', 'Cancelled'];
// #17: trimmed projection — only what the KDS screen renders. Never ...data.
const projectOrder = (id, d) => ({
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
    items: (Array.isArray(d.items) ? d.items : []).map((i) => ({
        name: String(i.name || ''),
        variant: String(i.variant || ''),
        qty: Number(i.quantity) || Number(i.qty) || 0,
        quantity: Number(i.quantity) || Number(i.qty) || 0,
        price: Number(i.price) || 0,
    })),
    itemsCount: Array.isArray(d.items)
        ? d.items.reduce((s, i) => s + (Number(i.quantity) || Number(i.qty) || 0), 0)
        : 0,
    total: Number(d.totalAmount) || 0,
    type: String(d.type || ''),
    status: String(d.status || 'Pending'),
    timestamp: d.timestamp?.toDate?.()?.toISOString?.() || (typeof d.timestamp === 'string' ? d.timestamp : new Date().toISOString()),
});
exports.getActiveOrders = (0, https_1.onCall)(async (request) => {
    (0, security_1.requireStaff)(request); // #6 + #7
    const db = (0, firestore_1.getFirestore)();
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
    }
    catch (error) {
        firebase_functions_1.logger.error('Error fetching active orders:', error);
        throw new https_1.HttpsError('internal', 'Failed to fetch active orders');
    }
});
exports.updateOrderStatus = (0, https_1.onCall)(async (request) => {
    (0, security_1.requireStaff)(request); // #6 + #7
    const orderId = (0, security_1.validDocId)(request.data?.orderId, 'orderId'); // #13
    const status = (0, security_1.cleanStr)(request.data?.status, 32, 'status'); // #14
    if (!VALID_STATUSES.includes(status))
        throw new https_1.HttpsError('invalid-argument', 'Invalid status'); // #8
    const cancellationReason = status === 'Cancelled' ? (0, security_1.optStr)(request.data?.cancellationReason, 200) : '';
    const db = (0, firestore_1.getFirestore)();
    try {
        const orderRef = db.collection('orders').doc(orderId);
        if (!(await orderRef.get()).exists)
            throw new https_1.HttpsError('not-found', 'Order not found');
        const update = { status };
        if (cancellationReason)
            update.cancellationReason = cancellationReason;
        await orderRef.update(update);
        firebase_functions_1.logger.info(`Order ${orderId} status updated to ${status}`);
        return { success: true };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        firebase_functions_1.logger.error(`Error updating order ${orderId} status:`, error);
        throw new https_1.HttpsError('internal', 'Failed to update order status');
    }
});
//# sourceMappingURL=kds.js.map