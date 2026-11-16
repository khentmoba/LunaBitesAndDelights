"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateOrderStatus = exports.getActiveOrders = exports.projectOrder = void 0;
exports.toIsoTimestamp = toIsoTimestamp;
exports.isOrderVisibleInKds = isOrderVisibleInKds;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const firebase_functions_1 = require("firebase-functions");
const security_1 = require("../util/security");
const VALID_STATUSES = ['Pending', 'Preparing', 'Ready', 'Completed', 'Cancelled'];
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';
/** Converts Firestore timestamps or ISO strings deterministically without crashing on invalid dates. */
function toIsoTimestamp(raw) {
    const fromObj = raw?.toDate?.();
    if (fromObj instanceof Date && !Number.isNaN(fromObj.getTime())) {
        return fromObj.toISOString();
    }
    if (typeof raw === 'string') {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime()))
            return parsed.toISOString();
    }
    return EPOCH_ISO;
}
/** Excludes unpaid/failed online GCash checkouts from the kitchen display until payment clears. */
function isOrderVisibleInKds(d) {
    const method = String(d.paymentMethod || '');
    const status = String(d.paymentStatus || '');
    return !(method === 'GCash' && (status === 'AWAITING_PAYMENT' || status === 'PAYMENT_FAILED'));
}
const itemQty = (i) => Number(i?.quantity) || Number(i?.qty) || 0;
// #17: trimmed projection — only what the KDS screen renders. Never ...data.
const projectOrder = (id, d) => {
    const rawItems = Array.isArray(d.items) ? d.items : [];
    return {
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
        items: rawItems.map((i) => {
            const qty = itemQty(i);
            return {
                name: String(i.name || ''),
                variant: String(i.variant || ''),
                qty,
                quantity: qty,
                price: Number(i.price) || 0,
            };
        }),
        itemsCount: rawItems.reduce((s, i) => s + itemQty(i), 0),
        total: Number(d.totalAmount) || 0,
        type: String(d.type || ''),
        status: String(d.status || 'Pending'),
        timestamp: toIsoTimestamp(d.timestamp),
    };
};
exports.projectOrder = projectOrder;
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
            if (!isOrderVisibleInKds(data))
                continue;
            const status = data.status || 'Pending';
            if (includeCompleted || (status !== 'Completed' && status !== 'Cancelled')) {
                orders.push((0, exports.projectOrder)(doc.id, data));
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