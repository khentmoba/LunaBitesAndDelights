/// Shared client-side input validators (#14).
/// NOTE: these are UX only — every callable re-validates server-side.
class V {
  static String? name(String? v, [int max = 100]) {
    if (v == null || v.trim().isEmpty) return 'Name is required';
    if (v.trim().length > max) return 'Name too long';
    return null;
  }

  static String? phone(String? v) {
    final p = (v ?? '').trim().replaceAll(RegExp(r'[\s-]'), '');
    if (p.isEmpty) return 'Phone is required';
    if (!RegExp(r'^(\+?63|0)9\d{9}$').hasMatch(p)) {
      return 'Enter a valid PH mobile number';
    }
    return null;
  }

  static String? email(String? v) {
    final e = (v ?? '').trim();
    if (e.isEmpty) return 'Email is required';
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(e)) {
      return 'Enter a valid email';
    }
    return null;
  }

  static String? password(String? v, [int min = 8]) {
    if (v == null || v.length < min) {
      return 'Password must be at least $min characters';
    }
    if (v.length > 128) return 'Password too long';
    return null;
  }

  static String? message(String? v, [int max = 1000]) {
    if (v == null || v.trim().isEmpty) return 'Message is required';
    if (v.trim().length > max) return 'Message too long (max $max)';
    return null;
  }

  static String? pin(String? v) {
    if (v == null || !RegExp(r'^\d{4,8}$').hasMatch(v.trim())) {
      return 'PIN must be 4–8 digits';
    }
    return null;
  }
}
