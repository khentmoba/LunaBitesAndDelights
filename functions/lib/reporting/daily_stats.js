"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statsItemKey = void 0;
exports.emptyDay = emptyDay;
exports.contributionOf = contributionOf;
exports.applyToDay = applyToDay;
exports.daysFromOrders = daysFromOrders;
exports.dayDeltas = dayDeltas;
exports.incrementPayload = incrementPayload;
exports.dayFromDoc = dayFromDoc;
exports.lifetimeReportFromDays = lifetimeReportFromDays;
const firestore_1 = require("firebase-admin/firestore");
const util_1 = require("../util");
/** Firestore map keys may not be empty and `/` reads badly in the console. */
const statsItemKey = (name, variant) => (0, util_1.itemKey)(name, variant).replace(/\//g, '∕') || 'Unknown';
exports.statsItemKey = statsItemKey;
const bucket = () => ({ revenue: 0, count: 0 });
function emptyDay(date) {
    return {
        date,
        revenue: 0,
        orders: 0,
        itemsSold: 0,
        channel: { walkIn: bucket(), delivery: bucket(), pickup: bucket() },
        entryType: { kiosk: bucket(), staff: bucket() },
        paymentMethod: { cash: bucket(), gcash: bucket() },
        items: {},
    };
}
/** Same counting rules the lifetime report has always used. */
function contributionOf(data) {
    if (!data || !(0, util_1.isCountableOrder)(data))
        return null;
    const items = {};
    let itemsSold = 0;
    for (const item of data.items || []) {
        const name = item.name || 'Unknown';
        const variant = item.variant || '';
        const qty = item.quantity || 1;
        itemsSold += qty;
        const key = (0, exports.statsItemKey)(name, variant);
        const slot = items[key] || (items[key] = { name, variant, qty: 0, revenue: 0 });
        slot.qty += qty;
        slot.revenue += (item.price || 0) * qty;
    }
    const type = data.type || 'Pickup';
    return {
        date: data.dateLabel || 'unknown',
        amount: data.totalAmount || 0,
        itemsSold,
        channel: type === 'Walk-In' ? 'walkIn' : type === 'Delivery' ? 'delivery' : 'pickup',
        entryType: data.entryType === 'Staff' ? 'staff' : 'kiosk',
        paymentMethod: String(data.paymentMethod || 'Cash').toLowerCase() === 'gcash' ? 'gcash' : 'cash',
        items,
    };
}
/** Adds (sign = 1) or removes (sign = -1) one order from an in-memory day. */
function applyToDay(day, c, sign) {
    day.revenue += sign * c.amount;
    day.orders += sign;
    day.itemsSold += sign * c.itemsSold;
    for (const b of [day.channel[c.channel], day.entryType[c.entryType], day.paymentMethod[c.paymentMethod]]) {
        b.revenue += sign * c.amount;
        b.count += sign;
    }
    for (const [key, it] of Object.entries(c.items)) {
        const slot = day.items[key] || (day.items[key] = { name: it.name, variant: it.variant, qty: 0, revenue: 0 });
        slot.qty += sign * it.qty;
        slot.revenue += sign * it.revenue;
    }
}
/** Recomputes day summaries from order documents (legacy path + backfill). */
function daysFromOrders(orders) {
    const days = new Map();
    for (const data of orders) {
        const c = contributionOf(data);
        if (!c)
            continue;
        let day = days.get(c.date);
        if (!day)
            days.set(c.date, (day = emptyDay(c.date)));
        applyToDay(day, c, 1);
    }
    return days;
}
const sameContribution = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/**
 * Per-day changes that move the summaries from an order's `before` state to
 * its `after` state. Empty when nothing countable changed (Pending →
 * Preparing, telegramSent, ...), so most order writes touch no stats.
 */
function dayDeltas(before, after) {
    const deltas = new Map();
    const b = contributionOf(before);
    const a = contributionOf(after);
    if (sameContribution(a, b))
        return deltas;
    for (const [c, sign] of [[b, -1], [a, 1]]) {
        if (!c)
            continue;
        let day = deltas.get(c.date);
        if (!day)
            deltas.set(c.date, (day = emptyDay(c.date)));
        applyToDay(day, c, sign);
    }
    return deltas;
}
/** Firestore merge-set payload that adds a delta day to `dailyStats/{date}`. */
function incrementPayload(d) {
    const inc = (n) => firestore_1.FieldValue.increment(n);
    const incGroup = (g) => Object.fromEntries(Object.entries(g)
        .filter(([, x]) => x.revenue !== 0 || x.count !== 0)
        .map(([k, x]) => [k, { revenue: inc(x.revenue), count: inc(x.count) }]));
    const items = Object.fromEntries(Object.entries(d.items)
        .filter(([, it]) => it.qty !== 0 || it.revenue !== 0)
        .map(([k, it]) => [k, { name: it.name, variant: it.variant, qty: inc(it.qty), revenue: inc(it.revenue) }]));
    return {
        date: d.date,
        revenue: inc(d.revenue),
        orders: inc(d.orders),
        itemsSold: inc(d.itemsSold),
        channel: incGroup(d.channel),
        entryType: incGroup(d.entryType),
        paymentMethod: incGroup(d.paymentMethod),
        items,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    };
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const readBucket = (v) => ({ revenue: num(v?.revenue), count: num(v?.count) });
/** Normalises a stored `dailyStats` document (missing fields read as 0). */
function dayFromDoc(id, d) {
    const day = emptyDay(typeof d.date === 'string' ? d.date : id);
    day.revenue = num(d.revenue);
    day.orders = num(d.orders);
    day.itemsSold = num(d.itemsSold);
    for (const k of ['walkIn', 'delivery', 'pickup'])
        day.channel[k] = readBucket(d.channel?.[k]);
    for (const k of ['kiosk', 'staff'])
        day.entryType[k] = readBucket(d.entryType?.[k]);
    for (const k of ['cash', 'gcash'])
        day.paymentMethod[k] = readBucket(d.paymentMethod?.[k]);
    for (const [k, it] of Object.entries(d.items || {})) {
        day.items[k] = { name: String(it?.name ?? k), variant: String(it?.variant ?? ''), qty: num(it?.qty), revenue: num(it?.revenue) };
    }
    return day;
}
/** The getLifetimeSalesReport response body, built from day summaries. */
function lifetimeReportFromDays(days, dateRange) {
    let totalRevenue = 0;
    let orderCount = 0;
    let totalItemsSold = 0;
    const total = emptyDay('');
    const dailySeries = [];
    for (const day of days) {
        if (day.orders <= 0)
            continue;
        totalRevenue += day.revenue;
        orderCount += day.orders;
        totalItemsSold += day.itemsSold;
        dailySeries.push({ date: day.date, revenue: day.revenue, orders: day.orders });
        for (const g of ['channel', 'entryType', 'paymentMethod']) {
            for (const [k, b] of Object.entries(day[g])) {
                const t = total[g][k];
                t.revenue += b.revenue;
                t.count += b.count;
            }
        }
        for (const [k, it] of Object.entries(day.items)) {
            const slot = total.items[k] || (total.items[k] = { name: it.name, variant: it.variant, qty: 0, revenue: 0 });
            slot.qty += it.qty;
            slot.revenue += it.revenue;
        }
    }
    const topItems = Object.values(total.items)
        .filter((it) => it.qty > 0)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 20)
        .map((it, index) => ({
        rank: index + 1,
        name: (0, util_1.itemKey)(it.name, it.variant),
        quantity: it.qty,
        revenue: it.revenue,
    }));
    dailySeries.sort((a, b) => a.date.localeCompare(b.date));
    return {
        success: true,
        dateRange,
        summary: {
            totalRevenue,
            orderCount,
            averageOrderValue: orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0,
            totalItemsSold,
        },
        breakdown: {
            channel: total.channel,
            entryType: total.entryType,
            paymentMethod: total.paymentMethod,
        },
        topItems,
        dailySeries,
    };
}
//# sourceMappingURL=daily_stats.js.map