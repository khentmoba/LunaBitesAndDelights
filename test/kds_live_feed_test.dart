import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart' show Timestamp;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:luna_bites_and_delights/screens/kds_page.dart';
import 'package:luna_bites_and_delights/services/audio_alert_service.dart';
import 'package:luna_bites_and_delights/services/cart_notifier.dart';
import 'package:luna_bites_and_delights/services/kds_feed.dart';
import 'package:luna_bites_and_delights/services/session.dart';

Map<String, dynamic> kdsOrder(
  String id,
  String name, {
  String status = 'Pending',
  String timestamp = '2026-11-15T02:00:00.000Z',
}) => {
  'id': id,
  'orderNumber': 'LU-$id',
  'customerName': name,
  'customerPhone': '',
  'customerAddress': '',
  'lat': null,
  'lng': null,
  'deliveryFee': 0,
  'paymentMethod': 'Cash',
  'paymentStatus': 'NOT PAID',
  'entryType': 'Kiosk',
  'items': [
    {
      'name': 'Shawarma Wrap',
      'variant': '',
      'qty': 1,
      'quantity': 1,
      'price': 79,
    },
  ],
  'itemsCount': 1,
  'total': 79,
  'type': 'Pickup',
  'status': status,
  'timestamp': timestamp,
};

Widget harness(KdsFeed feed) => MultiProvider(
  providers: [
    ChangeNotifierProvider.value(value: session),
    ChangeNotifierProvider.value(value: kioskSession),
    ChangeNotifierProvider.value(value: cartNotifier),
  ],
  child: MaterialApp(home: KdsPage(feed: feed)),
);

void main() {
  setUp(() {
    AudioAlertService.soundEnabled = false;
    session.login('staff_kiosk');
  });
  tearDown(() {
    session.logout();
    AudioAlertService.soundEnabled = true;
  });

  group('mergeKdsOrders', () {
    test('live copy wins over the polled copy and order is newest first', () {
      final merged = mergeKdsOrders(
        [kdsOrder('a', 'Ana', status: 'Ready')],
        [
          kdsOrder('a', 'Ana'),
          kdsOrder('b', 'Ben', timestamp: '2026-11-15T03:00:00.000Z'),
        ],
      );
      expect(merged.map((o) => o['id']), ['b', 'a']);
      expect(merged.last['status'], 'Ready');
    });

    test('mirror doc maps to the callable shape', () {
      final ts = Timestamp.fromDate(DateTime.utc(2026, 11, 15, 2));
      final o = kdsOrderFromDoc('x', {'status': 'Pending', 'ts': ts});
      expect(o.containsKey('ts'), isFalse);
      expect(o['id'], 'x');
      expect(o['timestamp'], '2026-11-15T02:00:00.000Z');
    });
  });

  testWidgets('pushed orders appear without polling and header says Live', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final feed = StreamController<List<Map<String, dynamic>>>();
    addTearDown(feed.close);

    await tester.pumpWidget(harness(() => feed.stream));
    await tester.pump();
    expect(find.text('Purok 5 Kiosk · Connecting…'), findsOneWidget);

    feed.add([kdsOrder('a', 'Ana Live')]);
    await tester.pump();
    expect(find.text('Purok 5 Kiosk · Live'), findsOneWidget);
    expect(find.text('Ana Live'), findsWidgets);

    // A status change pushed by the trigger moves the card; no fetch needed.
    feed.add([kdsOrder('a', 'Ana Live', status: 'Completed')]);
    await tester.pump();
    expect(find.text('Ana Live'), findsNothing, reason: 'closed orders hide');
    await tester.tap(find.text('HISTORY').first);
    await tester.pump();
    expect(tester.takeException(), isNull);
  });

  testWidgets('listener failure (rules not deployed) falls back to polling', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final feed = StreamController<List<Map<String, dynamic>>>();
    addTearDown(feed.close);

    await tester.pumpWidget(harness(() => feed.stream));
    feed.addError(Exception('permission-denied'));
    await tester.pump();
    expect(find.text('Purok 5 Kiosk · Auto-sync every 10s'), findsOneWidget);
  });
}
