import 'package:intl/intl.dart';

/// Philippines is UTC+8.
DateTime phtNow() => DateTime.now().toUtc().add(const Duration(hours: 8));

/// Converts an instant into PHT wall-clock calendar fields.
DateTime toPht(DateTime dt) => dt.toUtc().add(const Duration(hours: 8));

/// 'YYYY-MM-DD' label in PHT. Defaults to today.
String phtDateLabel([DateTime? dt]) {
  final d = dt ?? phtNow();
  String pad(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${pad(d.month)}-${pad(d.day)}';
}

/// Local-time stamp used for order history + Telegram: 'YYYY-MM-DD  HH:MM'.
String localStamp(DateTime dt) {
  String pad(int n) => n.toString().padLeft(2, '0');
  return '${dt.year}-${pad(dt.month)}-${pad(dt.day)}  ${pad(dt.hour)}:${pad(dt.minute)}';
}

/// 'Just now' / '5m ago' / '3h ago' / '2d ago'. With [absolute], dates older
/// than a week render as 'MMM d' instead.
String timeAgo(DateTime dt, {bool absolute = false}) {
  final diff = DateTime.now().difference(dt);
  if (diff.inMinutes < 1) return 'Just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  if (diff.inDays < 7 || !absolute) return '${diff.inDays}d ago';
  return DateFormat('MMM d').format(dt);
}
