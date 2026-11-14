/// What an order create must look like to pass `firestore.rules`
/// (`match /orders/{orderId}`). A checkout that breaks these values is
/// rejected by production, so `test/order_service_test.dart` turns every
/// combination into a fixture and `functions/test/firestore-rules.test.js`
/// runs each fixture through the real rules.
class OrderPolicy {
  static const maxItems = 50;
  static const maxNameLength = 100;

  /// Status fields for a new order. Customers may only send `Pending`,
  /// `NOT PAID` / `AWAITING_PAYMENT` and `Kiosk`; `Staff` and `PAID` need a
  /// signed-in user whose token carries `role: staff` or `role: admin`.
  static ({String status, String paymentStatus, String entryType}) statusesFor({
    required bool isStaff,
    required String paymentMethod,
  }) {
    if (isStaff) {
      return (status: 'Pending', paymentStatus: 'PAID', entryType: 'Staff');
    }
    return (
      status: 'Pending',
      paymentStatus: paymentMethod == 'GCash' ? 'AWAITING_PAYMENT' : 'NOT PAID',
      entryType: 'Kiosk',
    );
  }

  /// A reason the rules would reject this order, or null if they accept it.
  static String? rejectionFor({
    required String customerName,
    required int itemCount,
  }) {
    if (customerName.isEmpty) return 'Please enter a name for this order.';
    if (customerName.length > maxNameLength) {
      return 'Name is too long. Please keep it under $maxNameLength characters.';
    }
    if (itemCount > maxItems) {
      return 'An order can have up to $maxItems different items. '
          'Please split it into two orders.';
    }
    return null;
  }
}
