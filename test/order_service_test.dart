import 'dart:convert';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:luna_bites_and_delights/models/order.dart';
import 'package:luna_bites_and_delights/services/order_policy.dart';
import 'package:luna_bites_and_delights/services/order_service.dart';
import 'package:luna_bites_and_delights/services/session.dart';

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

String _encode(Map<String, dynamic> payload) => jsonEncode(
  payload,
  toEncodable: (value) =>
      (value as Timestamp).toDate().toUtc().toIso8601String(),
);

/// Builds an order exactly as checkout does for one combination.
OrderModel _checkoutOrder({
  required bool isStaff,
  required String paymentMethod,
}) {
  final s = OrderPolicy.statusesFor(
    isStaff: isStaff,
    paymentMethod: paymentMethod,
  );
  return OrderModel(
    orderId: 'LU-261114-120000',
    items: [
      OrderItem(name: 'Shawarma Wrap', variant: 'Solo', price: 60, quantity: 2),
    ],
    totalAmount: 120,
    timestamp: DateTime.utc(2026, 11, 14, 4),
    dateLabel: '2026-11-14',
    type: isStaff ? 'Walk-In' : 'Delivery',
    entryType: s.entryType,
    customerName: isStaff ? 'Walk-in Customer' : 'Ana Cruz',
    customerPhone: isStaff ? 'N/A' : '09171234567',
    customerAddress: isStaff ? 'Walk-In' : 'Purok 5, Poblacion Magallanes',
    lat: isStaff ? null : 9.0233,
    lng: isStaff ? null : 125.5194,
    totalDistance: isStaff ? 0.0 : 1.2,
    paymentMethod: paymentMethod,
    paymentStatus: s.paymentStatus,
    status: s.status,
  );
}

void main() {
  group('every checkout combination matches a rules fixture', () {
    for (final isStaff in [false, true]) {
      for (final method in ['Cash', 'GCash']) {
        final name = '${isStaff ? 'staff' : 'kiosk'}-${method.toLowerCase()}';
        test(name, () async {
          final firestore = _Firestore();
          final order = _checkoutOrder(isStaff: isStaff, paymentMethod: method);
          await OrderService.saveOrder(order, firestore: firestore);
          final json = _encode(firestore.orders.order.payload);
          final fixture = File('functions/test/fixtures/checkout/$name.json');
          if (Platform.environment['UPDATE_ORDER_FIXTURES'] == '1') {
            fixture
              ..parent.createSync(recursive: true)
              ..writeAsStringSync('$json\n');
          }
          expect(
            jsonDecode(fixture.readAsStringSync()),
            jsonDecode(json),
            reason:
                'Checkout changed what it writes. Regenerate with '
                'UPDATE_ORDER_FIXTURES=1 flutter test and make sure the '
                'rules tests still pass on the new fixture.',
          );
        });
      }
    }
  });

  test('customer orders only use values customers may send', () {
    for (final method in ['Cash', 'GCash', 'Card']) {
      final s = OrderPolicy.statusesFor(isStaff: false, paymentMethod: method);
      expect(s.status, 'Pending');
      expect(s.entryType, 'Kiosk');
      expect(['NOT PAID', 'AWAITING_PAYMENT'], contains(s.paymentStatus));
    }
  });

  test('checkout blocks orders the rules would reject', () {
    expect(
      OrderPolicy.rejectionFor(customerName: 'Ana', itemCount: 50),
      isNull,
    );
    expect(
      OrderPolicy.rejectionFor(customerName: 'a' * 100, itemCount: 1),
      isNull,
    );
    expect(
      OrderPolicy.rejectionFor(customerName: 'a' * 101, itemCount: 1),
      isNotNull,
    );
    expect(
      OrderPolicy.rejectionFor(customerName: 'Ana', itemCount: 51),
      isNotNull,
    );
    expect(OrderPolicy.rejectionFor(customerName: '', itemCount: 1), isNotNull);
  });

  test('only verifyStaff users with a staff claim get staff mode', () {
    expect(Session.staffUsernameFor('staff_ana'), 'ana');
    expect(Session.staffUsernameFor('staff_'), isNull);
    expect(Session.staffUsernameFor('rider123'), isNull);
    expect(Session.staffRoleFor({'role': 'staff'}), 'staff');
    expect(Session.staffRoleFor({'role': 'admin'}), 'admin');
    expect(Session.staffRoleFor({'role': 'rider'}), isNull);
    expect(Session.staffRoleFor({}), isNull);
    expect(Session.staffRoleFor(null), isNull);
  });

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
