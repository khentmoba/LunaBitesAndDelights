"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onOrderWritten = exports.DAILY_STATS_COLLECTION = exports.KDS_COLLECTION = void 0;
exports.kdsMirrorDoc = kdsMirrorDoc;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const firebase_functions_1 = require("firebase-functions");
const kds_1 = require("./kds");
const daily_stats_1 = require("../reporting/daily_stats");
exports.KDS_COLLECTION = 'kds_orders';
exports.DAILY_STATS_COLLECTION = 'dailyStats';
const EVENT_GUARD_COLLECTION = 'stats_events';
const GUARD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Kitchen-screen mirror doc: the same trimmed projection the callable returns, plus a queryable time. */
function kdsMirrorDoc(id, data) {
    const ts = data.timestamp instanceof firestore_2.Timestamp
        ? data.timestamp
        : firestore_2.Timestamp.fromDate(new Date(typeof data.timestamp === 'string' ? data.timestamp : Date.now()));
    return { ...(0, kds_1.projectOrder)(id, data), ts };
}
/**
 * Keeps two derived views in step with `orders/{id}`:
 *  - `kds_orders/{id}`: the staff-readable projection the kitchen screen
 *    listens to, so it gets pushed changes instead of polling a callable.
 *  - `dailyStats/{date}`: per-day sales totals for the lifetime report.
 * Stats increments are guarded by the event id, so a redelivered event
 * cannot count an order twice.
 */
exports.onOrderWritten = (0, firestore_1.onDocumentWritten)('orders/{orderId}', async (event) => {
    const db = (0, firestore_2.getFirestore)();
    const orderId = event.params.orderId;
    const before = event.data?.before?.exists ? event.data.before.data() : undefined;
    const after = event.data?.after?.exists ? event.data.after.data() : undefined;
    const mirrorRef = db.collection(exports.KDS_COLLECTION).doc(orderId);
    const mirror = (async () => {
        if (!after)
            return mirrorRef.delete();
        const next = kdsMirrorDoc(orderId, after);
        if (before && JSON.stringify(kdsMirrorDoc(orderId, before)) === JSON.stringify(next))
            return;
        return mirrorRef.set(next);
    })();
    const deltas = (0, daily_stats_1.dayDeltas)(before, after);
    const stats = deltas.size === 0 ? Promise.resolve() : db.runTransaction(async (tx) => {
        const guard = db.collection(EVENT_GUARD_COLLECTION).doc(event.id);
        if ((await tx.get(guard)).exists)
            return;
        tx.create(guard, {
            orderId,
            at: firestore_2.FieldValue.serverTimestamp(),
            expireAt: firestore_2.Timestamp.fromMillis(Date.now() + GUARD_TTL_MS),
        });
        for (const [date, delta] of deltas) {
            tx.set(db.collection(exports.DAILY_STATS_COLLECTION).doc(date), (0, daily_stats_1.incrementPayload)(delta), { merge: true });
        }
    });
    const results = await Promise.allSettled([mirror, stats]);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) {
        for (const f of failed)
            firebase_functions_1.logger.error(`Derived order views failed for ${orderId}`, f.reason);
        throw failed[0].reason;
    }
});
//# sourceMappingURL=derived.js.map