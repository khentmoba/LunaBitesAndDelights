"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.phtDateLabel = phtDateLabel;
exports.itemKey = itemKey;
exports.emptyChannel = emptyChannel;
exports.addToChannel = addToChannel;
exports.isCountableOrder = isCountableOrder;
/** Philippines is UTC+8. Returns 'YYYY-MM-DD'. */
function phtDateLabel(d = new Date()) {
    const pht = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    const m = String(pht.getUTCMonth() + 1).padStart(2, "0");
    const day = String(pht.getUTCDate()).padStart(2, "0");
    return `${pht.getUTCFullYear()}-${m}-${day}`;
}
/** Composite item key including variant: 'Name (Variant)' or 'Name'. */
function itemKey(name, variant) {
    return variant ? `${name} (${variant})` : name;
}
function emptyChannel() {
    const zero = () => ({ revenue: 0, count: 0 });
    return { walkIn: zero(), delivery: zero(), pickup: zero() };
}
/** Adds an order total to the matching channel bucket (Pickup default). */
function addToChannel(b, orderType, amount) {
    const bucket = orderType === "Walk-In" ? b.walkIn :
        orderType === "Delivery" ? b.delivery : b.pickup;
    bucket.revenue += amount;
    bucket.count += 1;
}
/**
 * Returns false for cancelled orders and unpaid/failed GCash orders so
 * sales reports and analytics only count real revenue.
 */
function isCountableOrder(data) {
    if (!data)
        return false;
    if (data.status === "Cancelled")
        return false;
    const method = String(data.paymentMethod || "").toLowerCase();
    const paymentStatus = String(data.paymentStatus || "");
    if (method === "gcash" && (paymentStatus === "AWAITING_PAYMENT" || paymentStatus === "PAYMENT_FAILED")) {
        return false;
    }
    return true;
}
//# sourceMappingURL=util.js.map