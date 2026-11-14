import 'package:cloud_firestore/cloud_firestore.dart';

/// Live kitchen orders from `kds_orders`, the staff-readable mirror the
/// `onOrderWritten` Cloud Function keeps in step with `orders`.
///
/// Each event is the full list (newest first) in the same map shape the
/// `getActiveOrders` callable returns. After the first snapshot Firestore
/// only sends changed documents, so an idle kitchen screen costs no reads.
typedef KdsFeed = Stream<List<Map<String, dynamic>>> Function();

const kdsLookback = Duration(days: 7);
const kdsLimit = 200;

Stream<List<Map<String, dynamic>>> watchKdsOrders() {
  final since = Timestamp.fromDate(DateTime.now().subtract(kdsLookback));
  return FirebaseFirestore.instance
      .collection('kds_orders')
      .where('ts', isGreaterThanOrEqualTo: since)
      .orderBy('ts', descending: true)
      .limit(kdsLimit)
      .snapshots()
      .map(
        (snap) =>
            snap.docs.map((d) => kdsOrderFromDoc(d.id, d.data())).toList(),
      );
}

/// Mirror doc → callable-shaped order map (`timestamp` as an ISO string).
Map<String, dynamic> kdsOrderFromDoc(String id, Map<String, dynamic> data) {
  final out = Map<String, dynamic>.from(data)..remove('ts');
  out['id'] ??= id;
  final ts = data['ts'];
  if (out['timestamp'] is! String && ts is Timestamp) {
    out['timestamp'] = ts.toDate().toUtc().toIso8601String();
  }
  return out;
}

/// Live orders win; callable-only orders (placed before the mirror existed)
/// stay until the mirror has them. Newest first.
List<Map<String, dynamic>> mergeKdsOrders(
  List<Map<String, dynamic>> live,
  List<Map<String, dynamic>> polled,
) {
  String key(Map<String, dynamic> o) =>
      (o['id'] ?? o['orderNumber']).toString();
  final byId = {for (final o in polled) key(o): o};
  for (final o in live) {
    byId[key(o)] = o;
  }
  final merged = byId.values.toList()
    ..sort(
      (a, b) => (b['timestamp'] ?? '').toString().compareTo(
        (a['timestamp'] ?? '').toString(),
      ),
    );
  return merged;
}

bool isClosedKdsStatus(Object? status) =>
    status == 'Completed' || status == 'Cancelled';
