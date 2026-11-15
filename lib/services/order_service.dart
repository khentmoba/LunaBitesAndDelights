import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import '../models/order.dart';
import '../utils/format.dart';
import 'telegram_service.dart';

class OrderService {
  static final FirebaseFirestore _db = FirebaseFirestore.instance;

  /// Full order pipeline: Firestore save → Telegram notify → in-memory
  /// history for the admin dashboard.
  ///
  /// The order is persisted first so a failed notification can never lose a
  /// paid-for order. [docId] is the Firestore document id and the only stable
  /// handle for later payment/webhook updates; [orderId] is the display
  /// number and is not guaranteed unique.
  static Future<({String? docId, bool telegramSent})> placeOrder(
    OrderModel order,
    String timeStr,
  ) async {
    final docId = await saveOrder(order);
    if (docId == null) {
      return (docId: null, telegramSent: false);
    }

    final telegramSent = await TelegramService.sendOrder(
      order: order,
      timeStr: timeStr,
      orderDocId: docId,
    );

    final isUnconfirmedGcash =
        order.paymentMethod == 'GCash' &&
        (order.paymentStatus == 'AWAITING_PAYMENT' ||
            order.paymentStatus == 'PAYMENT_FAILED');
    if (!isUnconfirmedGcash) {
      recordLocalHistory(order, timeStr);
    }
    return (docId: docId, telegramSent: telegramSent);
  }

  /// Appends a confirmed order to the local fallback ledger used before server
  /// analytics responds.
  static void recordLocalHistory(OrderModel order, String timeStr) {
    orderHistory.add({
      'orderNumber': order.orderId,
      'customerName': order.customerName,
      'items': order.items
          .map(
            (i) => {
              'name': i.name,
              'variant': i.variant,
              'qty': i.quantity,
              'price': i.price,
            },
          )
          .toList(),
      'itemsCount': order.items.fold(0, (s, i) => s + i.quantity),
      'total': order.totalAmount,
      'time': timeStr,
      'type': order.type,
      'isWalkIn': order.entryType == 'Staff',
    });
  }

  /// Writes the order and returns its document id, or null if the write failed.
  static Future<String?> saveOrder(
    OrderModel order, {
    FirebaseFirestore? firestore,
  }) async {
    try {
      final ref = (firestore ?? _db).collection('orders').doc();
      await ref.set(order.toJson());
      debugPrint('Order ${order.orderId} saved to Firestore as ${ref.id}');
      return ref.id;
    } catch (e) {
      debugPrint('Error saving order ${order.orderId}: $e');
      return null;
    }
  }
}

// ── In-memory order history for the admin dashboard ──
final List<Map<String, dynamic>> orderHistory = [];

int get todayRevenue =>
    _todayOrders.fold(0, (s, o) => s + ((o['total'] as num?)?.toInt() ?? 0));
int get todayOrderCount => _todayOrders.length;
int get todayItemsSold => _todayOrders.fold(
  0,
  (s, o) => s + ((o['itemsCount'] as num?)?.toInt() ?? 0),
);
double get avgOrderValue =>
    todayOrderCount > 0 ? todayRevenue / todayOrderCount : 0;

List<Map<String, dynamic>> get _todayOrders => orderHistory.where((o) {
  final t = (o['time'] ?? '').toString();
  return t.startsWith(phtDateLabel());
}).toList();
