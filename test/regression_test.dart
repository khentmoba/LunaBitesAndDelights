import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:luna_bites_and_delights/services/delivery.dart';
import 'package:luna_bites_and_delights/services/cart_notifier.dart';
import 'package:luna_bites_and_delights/models/cart.dart';
import 'package:luna_bites_and_delights/utils/format.dart';
import 'package:luna_bites_and_delights/models/order.dart';
import 'package:luna_bites_and_delights/data/menu_data.dart';
import 'package:luna_bites_and_delights/services/telegram_service.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

CartItem item({
  String id = '1',
  String variant = 'Solo',
  int price = 100,
  int qty = 1,
}) => CartItem(
  id: id,
  name: 'Burger',
  emoji: '🍔',
  imageUrl: '',
  variant: variant,
  price: price,
  quantity: qty,
);

void main() {
  group('delivery math', () {
    test('same point = zero distance', () {
      expect(
        haversine(storeLat, storeLng, storeLat, storeLng),
        closeTo(0, 1e-6),
      );
    });

    test('known distance sane (~11km between kitchens)', () {
      expect(
        haversine(storeLat, storeLng, base2Lat, base2Lng),
        inInclusiveRange(9, 14),
      );
    });

    test('distance uses the nearer kitchen', () {
      expect(deliveryDistance(storeLat, storeLng), closeTo(0, 1e-6));
      expect(deliveryDistance(base2Lat, base2Lng), closeTo(0, 1e-6));
      final mid = deliveryDistance(
        (storeLat + base2Lat) / 2,
        (storeLng + base2Lng) / 2,
      );
      expect(mid, greaterThan(0));
      expect(mid, lessThan(haversine(storeLat, storeLng, base2Lat, base2Lng)));
    });
  });

  group('cart', () {
    test('add merges same name+variant, totals correct', () {
      final cart = CartNotifier();
      cart.add(item(qty: 2));
      cart.add(item(qty: 3)); // same variant -> merge
      cart.add(item(id: '2', variant: 'Combo', price: 200));
      expect(cart.items.length, 2);
      expect(cart.totalCount, 6);
      expect(cart.totalPrice, 5 * 100 + 200);
    });

    test('increment/decrement/remove/clear', () {
      final cart = CartNotifier();
      cart.add(item());
      cart.increment('1');
      expect(cart.items.first.quantity, 2);
      cart.decrement('1');
      expect(cart.items.first.quantity, 1);
      cart.decrement('1'); // qty 1 -> removed
      expect(cart.items, isEmpty);
      cart.add(item());
      cart.remove('1');
      expect(cart.items, isEmpty);
      cart.add(item());
      cart.clear();
      expect(cart.totalCount, 0);
      expect(cart.totalPrice, 0);
    });
  });

  group('format', () {
    test('phtDateLabel pads correctly', () {
      expect(phtDateLabel(DateTime(2026, 1, 5)), '2026-01-05');
    });

    test('localStamp format', () {
      expect(localStamp(DateTime(2026, 9, 28, 9, 5)), '2026-09-28  09:05');
    });

    test('timeAgo buckets', () {
      final now = DateTime.now();
      expect(timeAgo(now), 'Just now');
      expect(timeAgo(now.subtract(const Duration(minutes: 5))), '5m ago');
      expect(timeAgo(now.subtract(const Duration(hours: 3))), '3h ago');
      expect(timeAgo(now.subtract(const Duration(days: 2))), '2d ago');
    });
  });

  group('order serialization', () {
    test('generateOrderNumber generates a PHT timestamp number', () {
      final orderNumber = TelegramService.generateOrderNumber();
      expect(RegExp(r'^LU-\d{6}-\d{6}$').hasMatch(orderNumber), isTrue);
    });

    test('OrderItem total = price * qty', () {
      final j = OrderItem(
        name: 'Fries',
        variant: 'Solo',
        price: 50,
        quantity: 3,
      ).toJson();
      expect(j['total'], 150);
    });

    test('OrderModel round-trips all fields', () {
      final ts = DateTime(2026, 9, 28, 12);
      final j = OrderModel(
        orderId: 'LX-1',
        items: [
          OrderItem(name: 'Burger', variant: 'Solo', price: 100, quantity: 2),
        ],
        totalAmount: 200,
        timestamp: ts,
        dateLabel: '2026-09-28',
        type: 'Delivery',
        entryType: 'Kiosk',
        customerName: 'Juan',
        customerPhone: '0917',
        customerAddress: 'Butuan',
      ).toJson();
      expect(j['orderId'], 'LX-1');
      expect((j['items'] as List).length, 1);
      expect(j['totalAmount'], 200);
      expect((j['timestamp'] as Timestamp).toDate(), ts);
      expect(j['paymentStatus'], 'NOT PAID'); // defaults preserved
      expect(j['status'], 'Pending');
    });
  });

  group('menu sections and new meals', () {
    test(
      'menu keeps Korean Spam Musubi and S3 shawarma rice while standalone rice bowl is retired',
      () {
        final items = kMenuSections.expand((section) => section.items);
        expect(
          items.firstWhere((item) => item.id == 'sm5').name,
          'S5 – Korean Spam Musubi',
        );
        expect(items.any((item) => item.name == 'S3 – Shawarma Rice'), isTrue);
        expect(
          items.any(
            (item) => item.id == 's3' || item.name == 'Shawarma Rice Bowl',
          ),
          isFalse,
        );
      },
    );

    test('drinks section has no large promo indicator on any drink', () {
      final drinks = kMenuSections.firstWhere((s) => s.id == 'drinks');
      for (final item in drinks.items) {
        expect(
          item.promoLabel,
          isNot('LARGE'),
          reason: '${item.name} should not have LARGE promoLabel',
        );
      }
    });

    test('retired items are gone and the owner price board is enforced', () {
      final items = kMenuSections.expand((section) => section.items).toList();
      final names = items.map((item) => item.name).toSet();
      for (final retired in [
        'Lemon Yakult',
        'Lemon Yogurt',
        'Hotdog Sandwich',
        'Ice Cream Halo-Halo',
      ]) {
        expect(names.contains(retired), isFalse, reason: '$retired is retired');
      }

      final byId = {for (final item in items) item.id: item};
      for (final id in ['mc1', 'mc2', 'mc3', 'mc4', 'cf_chuckie', 'cf_milo']) {
        expect(byId[id]!.price, 65, reason: '$id is ₱65');
      }
      expect(byId['s5']!.price, 99, reason: 'Shawarma Fries is ₱99');
      expect(byId['s6']!.price, 99, reason: 'Shawarma Nachos is ₱99');

      for (final id in [
        'cf_coke',
        'cf_latte',
        'cf_macchiato',
        'cf_cappuccino',
        'cf_choc_coffee',
      ]) {
        expect(byId[id]!.price, 49, reason: '$id is a flat ₱49');
        expect(byId[id]!.hasVariants, isFalse, reason: '$id has no sizes');
      }

      expect(
        kMenuSections.firstWhere((s) => s.id == 'burger_hotdog_combined').title,
        'Burgers',
      );
    });

    test('soda pop is retired and the Strawberry cooler stays', () {
      final items = kMenuSections.expand((section) => section.items).toList();
      final names = items.map((item) => item.name).toSet();
      for (final retired in [
        'Green Apple',
        'Sweet Orange',
        'Mixed Berries',
        'Four Seasons',
      ]) {
        expect(names.contains(retired), isFalse, reason: '$retired is retired');
      }
      expect(names.contains('SODA POP'), isFalse);
      expect(
        items.any((item) => item.name == 'Strawberry' && item.price == 39),
        isTrue,
        reason: 'the Strawberry cooler stays',
      );
    });

    test('Blue Lemonade joins the Lemon Series at ₱49', () {
      final lemon = kMenuSections
          .firstWhere((s) => s.id == 'drinks')
          .items
          .firstWhere((i) => i.name == 'Blue Lemonade');
      expect(lemon.price, 49);
      expect(lemon.imageUrl, 'images/blue_lemonade.png');
      expect(File(lemon.imageUrl).existsSync(), isTrue);
    });

    test('contains sulit_meals and chicken_poppers sections', () {
      final sectionIds = kMenuSections.map((s) => s.id).toList();
      expect(sectionIds, contains('sulit_meals'));
      expect(sectionIds, contains('chicken_poppers'));
    });

    test('sulit_meals contains S1-S5 and Pork Sisig with valid assets', () {
      final sulit = kMenuSections.firstWhere((s) => s.id == 'sulit_meals');
      expect(sulit.items.length, 6);
      for (final item in sulit.items) {
        expect(item.displayPrice, 99);
        expect(item.imageUrl, isNotEmpty);
        expect(
          File(item.imageUrl).existsSync(),
          isTrue,
          reason: 'Asset ${item.imageUrl} must exist on disk',
        );
      }
    });

    test(
      'chicken_poppers contains all 6 signature flavors with valid assets',
      () {
        final poppers = kMenuSections.firstWhere(
          (s) => s.id == 'chicken_poppers',
        );
        expect(poppers.items.length, 6);
        for (final item in poppers.items) {
          expect(item.displayPrice, 99);
          expect(item.imageUrl, isNotEmpty);
          expect(
            File(item.imageUrl).existsSync(),
            isTrue,
            reason: 'Asset ${item.imageUrl} must exist on disk',
          );
        }
      },
    );
  });
}
