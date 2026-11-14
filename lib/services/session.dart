import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

class Session extends ChangeNotifier {
  String? _username;
  String? _role;

  bool get isStaff => _username != null;
  String get username => _username ?? '';
  bool get isAdmin => _role == 'admin' || _username?.toLowerCase() == 'admin';
  String get role => _role ?? (isAdmin ? 'admin' : 'staff');

  Session() {
    _initAuth();
  }

  void _initAuth() {
    try {
      // Restore session if user was already signed in with a staff custom token
      final current = FirebaseAuth.instance.currentUser;
      if (current != null) {
        _extractUser(current);
      }
      FirebaseAuth.instance.authStateChanges().listen((user) {
        if (user != null) {
          _extractUser(user);
        } else {
          _username = null;
          _role = null;
          notifyListeners();
        }
      });
    } catch (_) {
      // In unit test environments where Firebase is not initialized, ignore gracefully.
    }
  }

  /// The staff username for a Firebase uid minted by `verifyStaff`, or null.
  static String? staffUsernameFor(String uid) =>
      uid.startsWith('staff_') && uid.length > 6 ? uid.substring(6) : null;

  /// The role from token claims if `firestore.rules` treats it as staff.
  static String? staffRoleFor(Map<String, dynamic>? claims) {
    final role = claims?['role'];
    return role == 'admin' || role == 'staff' ? role as String : null;
  }

  /// Staff mode writes `Staff`/`PAID` orders, which the rules accept only
  /// from a `staff_` user with a staff role claim. Any other signed-in user
  /// stays in customer mode so their orders still save.
  void _extractUser(User user) {
    final username = staffUsernameFor(user.uid);
    if (username == null) {
      _clear();
      return;
    }
    _username = username;
    _role = username.toLowerCase() == 'admin' ? 'admin' : 'staff';
    notifyListeners();
    user
        .getIdTokenResult()
        .then((tokenResult) {
          final claimRole = staffRoleFor(tokenResult.claims);
          if (claimRole == null) {
            logout();
          } else if (_role != claimRole) {
            _role = claimRole;
            notifyListeners();
          }
        })
        .catchError((_) {});
  }

  void _clear() {
    if (_username == null && _role == null) return;
    _username = null;
    _role = null;
    notifyListeners();
  }

  void login(String username, {String role = 'staff'}) {
    _username = username;
    _role = role;
    notifyListeners();
  }

  Future<void> logout() async {
    _username = null;
    _role = null;
    // End the Firebase staff session too (custom token from verifyStaff).
    try {
      await FirebaseAuth.instance.signOut();
    } catch (_) {}
    notifyListeners();
  }
}

enum DiningMode { eatIn, takeOut }

class KioskSession extends ChangeNotifier {
  DiningMode? _diningMode;
  String _currentCategoryId = 'sulit_meals';

  DiningMode? get diningMode => _diningMode;
  String get currentCategoryId => _currentCategoryId;

  void setDiningMode(DiningMode mode) {
    _diningMode = mode;
    notifyListeners();
  }

  void setCategory(String categoryId) {
    _currentCategoryId = categoryId;
    notifyListeners();
  }

  void reset() {
    _diningMode = null;
    _currentCategoryId = 'sulit_meals';
    notifyListeners();
  }
}

final session = Session();
final kioskSession = KioskSession();
