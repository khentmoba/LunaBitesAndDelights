import 'dart:convert';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:luna_bites_and_delights/models/order.dart';
import 'package:luna_bites_and_delights/services/order_service.dart';

class _Firestore extends Fake implements FirebaseFirestore {
  final orders = _Orders();

  @override
  CollectionReference<Map<String, dynamic>> collection(String path) {
    expect(path, 'orders');
    return orders;
  }
}

// Firestore 6 sealed these interfaces, so a hand-rolled fake cannot satisfy
// them without tripping the analyzer. The alternative is a mocking package plus
// codegen for one regression test; these two suppressions are the cheaper trade.
// ignore: subtype_of_sealed_class
class _Orders extends Fake
    implements CollectionReference<Map<String, dynamic>> {
  final order = _OrderDocument();

  @override
  DocumentReference<Map<String, dynamic>> doc([String? path]) => order;
}

// ignore: subtype_of_sealed_class
class _OrderDocument extends Fake
    implements DocumentReference<Map<String, dynamic>> {
  late final Map<String, dynamic> payload;

  @override
  String get id => 'testOrderReference';

  @override
  Future<void> set(Map<String, dynamic> data, [SetOptions? options]) async {
    payload = data;
  }
}

void main() {
  test(
    'initial order write leaves notification status to the server',
    () async {
      final firestore = _Firestore();
      final order = OrderModel(
        orderId: 'LU-261029-120000',
        items: [
          OrderItem(
            name: 'Shawarma Wrap',
            variant: 'Solo',
            price: 60,
            quantity: 1,
          ),
        ],
        totalAmount: 60,
        timestamp: DateTime.utc(2026, 10, 29, 4),
        dateLabel: '2026-10-29',
        type: 'Pickup',
        entryType: 'Kiosk',
        customerName: 'Checkout regression fixture',
        customerPhone: '09000000000',
        customerAddress: 'Pickup',
      );

      final docId = await OrderService.saveOrder(order, firestore: firestore);
      final payload = firestore.orders.order.payload;
      final json = jsonEncode(
        payload,
        toEncodable: (value) =>
            (value as Timestamp).toDate().toUtc().toIso8601String(),
      );
      expect(jsonDecode(json)['timestamp'], '2026-10-29T04:00:00.000Z');
      final evidencePath = Platform.environment['ORDER_PAYLOAD_OUTPUT'];
      if (evidencePath != null) File(evidencePath).writeAsStringSync('$json\n');

      expect(
        jsonDecode(
          File('functions/test/fixtures/order-create.json').readAsStringSync(),
        ),
        jsonDecode(json),
        reason: 'The emulator fixture must match the actual order write.',
      );
      expect(docId, 'testOrderReference');
      expect(payload, order.toJson());
      expect(payload.containsKey('telegramSent'), isFalse);
      expect(payload['paymentStatus'], 'NOT PAID');
      expect(payload['status'], 'Pending');
    },
  );
}
