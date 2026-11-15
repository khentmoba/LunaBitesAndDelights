import 'package:flutter/material.dart';
import '../models/cart.dart';

class CartNotifier extends ChangeNotifier {
  final List<CartItem> _items = [];
  List<CartItem> get items => List.unmodifiable(_items);

  int get totalCount => _items.fold(0, (s, i) => s + i.quantity);
  int get totalPrice => _items.fold(0, (s, i) => s + i.price * i.quantity);

  void add(CartItem item) {
    final existing = _items.where(
      (c) => c.name == item.name && c.variant == item.variant,
    );
    if (existing.isNotEmpty) {
      existing.first.quantity += item.quantity;
    } else {
      _items.add(item);
    }
    notifyListeners();
  }

  void remove(String id) {
    _items.removeWhere((c) => c.id == id);
    notifyListeners();
  }

  void increment(String id) {
    final idx = _items.indexWhere((c) => c.id == id);
    if (idx == -1) return;
    _items[idx].quantity++;
    notifyListeners();
  }

  void decrement(String id) {
    final idx = _items.indexWhere((c) => c.id == id);
    if (idx == -1) return;
    if (_items[idx].quantity <= 1) {
      _items.removeAt(idx);
    } else {
      _items[idx].quantity--;
    }
    notifyListeners();
  }

  void clear() {
    _items.clear();
    notifyListeners();
  }
}

final cartNotifier = CartNotifier();
