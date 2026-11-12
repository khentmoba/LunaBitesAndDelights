"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCheckoutSession = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const firebase_functions_1 = require("firebase-functions");
const index_1 = require("../index");
const security_1 = require("../util/security");
const PAYMONGO_API = 'https://api.paymongo.com/v2/checkout_sessions';
// Server-side price list — single source of truth for payment verification.
// MUST match lib/data/menu_data.dart. Name → allowed prices (variants/collisions).
// #8: never trust client-supplied prices; they only pick name+variant+qty.
const MENU_PRICES = {
    'Shawarma Wrap': [99, 60], 'Shawarma All Meat': [80],
    'Shawarma Burger': [95], 'Shawarma Fries': [99], 'Shawarma Nachos': [99],
    'Shawarma Quesadilla': [99], 'Nachos & Fries Overload': [99, 150],
    'Shawarma Wrap + Fries + Drinks': [128], 'Shawarma Burger + Shawarma Wrap + Drinks': [149],
    'Combo 2 – Shawarma Wrap + Fries': [99],
    'Super Combo 1 – Burger + Fries + Drink': [99],
    'Super Combo 2 – Shawarma Wrap + Fries + Drink': [128],
    'Combo 4 – Shawarma Wrap + Burger + Fries': [139],
    'Combo 6 – Shawarma Wrap + Shawarma Burger + Drink': [150],
    'D1 – Fries + Drink': [55], 'D2 – Fries + Hotdog + Drink': [65],
    'D3 – Fries + Hotdog + Cheesestick + Drink': [75],
    'D4 – Fries + Hotdog + Cheesestick + Fried Siomai + Drink': [89],
    'Ube Halo Ice Cream': [65], 'Mango Graham Ice Cream': [65],
    'Choco Oreo Ice Cream': [65], 'Vanilla Cheese Ice Cream': [65], 'Luna Leche Flan': [20],
    // Previous names/prices below remain valid for carts from cached clients.
    'Shawarma Rice Bowl': [50], 'Lemon Yakult': [49], 'Lemon Yogurt': [49],
    'Hotdog Sandwich': [69],
    'Buy 1 Take 1 French Fries': [50], 'Large Fries': [75], 'Bucket Fries': [99], 'Terra Fries': [150],
    'Combo 1 – Burger + Fries': [60], 'Combo 2 – Hotdog + Fries': [60],
    'Super Combo 1 – Hotdog + Fries + Drink': [99], 'Super Combo 2 – Burger + Fries + Drink': [99],
    'Couple Snack Combo': [169], 'Combo Promo - Halo Halo + Fries + Shawarma Wrap': [149],
    'Quesadilla': [75], 'Ice Cream Halo-Halo': [49, 65],
    'Mango-Graham Ice Cream Overload': [65], 'Leche Flan': [20, 39],
    'Purple Taro': [39], 'Cookies N Cream': [39], 'Dark Chocolate': [39], 'Black Forest': [39],
    'Strawberry': [39, 49], 'Rocky Road': [39], 'Choco Kisses': [39], '3 for ₱100 Coolers': [100],
    'Classic Lemonade': [49], 'Lemon Strawberry': [49],
    'Lemon Cucumber': [49],
    'Green Apple': [49], 'Sweet Orange': [49], 'Mixed Berries': [49], 'Four Seasons': [49],
    'Cookies & Cream Overload': [65], 'Chocolate Oreo': [65], 'Strawberry Oreo': [65], 'Milo Oreo Float': [65],
    'Milo Dinosaur': [65], 'Milo Float': [65], 'Milo Crunch': [65], 'Milo Oreo': [65],
    'Coke Float': [49], 'Chuckie Float': [65], 'Cookies and Cream Float': [65],
    'Cafe Latte': [49], 'Caramel Macchiato': [49],
    'Ice Cappuccino': [49], 'Chocolate Coffee': [49],
    'Burger Patty': [55], 'Ham & Cheese': [55], 'Cheese Burger': [65],
    'Burger with Egg': [85], 'Cheese & Egg Burger': [95],
    // Cached clients can still submit the previous name for this same ₱95 burger.
    'Egg & Cheese': [95],
    // Sulit Meals + Chicken Poppers. A parity test in test/menu_price_parity_test.dart
    // fails the build when this map drifts from lib/data/menu_data.dart.
    'S1 – Hungarian Sausage': [99], 'S2 – Pork Tocino': [99], 'S3 – Shawarma Rice': [99],
    'S4 – Jumbo Hotdog': [99], 'S5 – Korean Spam Musubi': [99], "Luna's Pork Sisig": [99],
    'Korean Barbeque Poppers': [99], 'Korean Yangnyeom Poppers': [99],
    'Lemon Glaze Poppers': [99], 'Teriyaki Gloss Poppers': [99],
    'Creamy Cheese Poppers': [99], 'Mango Habanero Poppers': [99],
};
exports.createCheckoutSession = (0, https_1.onCall)({ secrets: [index_1.paymongoSecret] }, // #1
async (request) => {
    const d = request.data || {};
    const orderDocId = (0, security_1.cleanStr)(d.orderDocId, 64, 'orderDocId');
    const orderId = (0, security_1.cleanStr)(d.orderId, 64, 'orderId');
    const amount = (0, security_1.cleanInt)(d.amount, 1000000, 'amount');
    const customerName = (0, security_1.optStr)(d.customerName, 100);
    const customerPhone = (0, security_1.optStr)(d.customerPhone, 32);
    // The payment result must land on the order document the kiosk wrote.
    // Firestore auto-ids are alphanumeric; anything else is not a doc id.
    if (!/^[A-Za-z0-9]{1,64}$/.test(orderDocId)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid order reference');
    }
    const orderRef = (0, firestore_1.getFirestore)().collection('orders').doc(orderDocId);
    if (!(await orderRef.get()).exists) {
        throw new https_1.HttpsError('not-found', 'Order not found');
    }
    if (!Array.isArray(d.items) || d.items.length === 0 || d.items.length > 50) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid items');
    }
    // #8 + #14: verify every line against server prices, recompute total.
    let itemsTotal = 0;
    const lineItems = d.items.map((i) => {
        const name = (0, security_1.cleanStr)(i?.name, 120, 'item name');
        const qty = (0, security_1.cleanInt)(i?.quantity ?? 1, 99, 'quantity') || 1;
        const allowed = MENU_PRICES[name];
        if (!allowed)
            throw new https_1.HttpsError('invalid-argument', `Unknown item: ${name}`);
        const price = Number(i?.price);
        if (!allowed.includes(price)) {
            throw new https_1.HttpsError('invalid-argument', `Price mismatch for ${name}`);
        }
        itemsTotal += price * qty;
        return { name, amount: price * 100, currency: 'PHP', quantity: qty };
    });
    // The rider confirms delivery separately; online payment covers food only.
    if (amount !== itemsTotal) {
        throw new https_1.HttpsError('invalid-argument', 'Amount does not match order total');
    }
    const paymongoKey = index_1.paymongoSecret.value();
    if (!paymongoKey)
        throw new https_1.HttpsError('internal', 'Payment service not configured');
    const auth = Buffer.from(`${paymongoKey}:`).toString('base64');
    try {
        const response = await fetch(PAYMONGO_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
            body: JSON.stringify({
                data: {
                    attributes: {
                        line_items: lineItems,
                        payment_method_types: ['gcash', 'paymaya'],
                        success_url: 'https://lunabitesanddelights.web.app/payment/success',
                        cancel_url: 'https://lunabitesanddelights.web.app/payment/cancel',
                        reference_number: orderId,
                        description: `Luna Bites & Delights Order #${orderId}`,
                        metadata: {
                            order_id: orderId,
                            order_doc_id: orderDocId,
                            customer_name: customerName,
                            customer_phone: customerPhone,
                        },
                    },
                },
            }),
        });
        const json = await response.json();
        if (!response.ok) {
            firebase_functions_1.logger.error('PayMongo create checkout failed:', json.errors);
            throw new https_1.HttpsError('internal', 'Payment provider error'); // #17: don't leak provider detail
        }
        const checkout = json.data;
        await orderRef.set({
            checkoutSessionId: checkout.id,
            checkoutUrl: checkout.attributes.checkout_url,
            paymentMethod: 'GCash',
            paymentStatus: 'AWAITING_PAYMENT',
            verifiedTotal: itemsTotal,
        }, { merge: true });
        firebase_functions_1.logger.info(`Checkout session created for order ${orderId}: ${checkout.id}`);
        // #17: only what the client needs to redirect.
        return { success: true, checkoutUrl: checkout.attributes.checkout_url, checkoutSessionId: checkout.id };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        firebase_functions_1.logger.error('Error creating PayMongo checkout:', error);
        throw new https_1.HttpsError('internal', 'Failed to create checkout session');
    }
});
//# sourceMappingURL=create_checkout.js.map