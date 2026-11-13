import 'package:flutter/material.dart';
import '../widgets/kiosk/kiosk_theme.dart';
import '../widgets/kiosk/juicy_feedback.dart';
import '../models/cart.dart';
import '../models/order.dart';
import '../services/cart_notifier.dart';
import '../services/delivery.dart';
import '../services/telegram_service.dart';
import '../services/order_service.dart';
import '../services/session.dart';
import '../utils/format.dart';
import 'map_picker_page.dart';
import 'receipt_page.dart';
import 'gcash_checkout_page.dart';

class CheckoutPage extends StatefulWidget {
  const CheckoutPage({super.key});

  @override
  State<CheckoutPage> createState() => _CheckoutPageState();
}

class _CheckoutPageState extends State<CheckoutPage> {
  final _nameCtrl = TextEditingController();
  final _addressCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  double _pinnedLat = storeLat;
  double _pinnedLng = storeLng;
  bool _locationPinned = false;
  double _distance = 0.0;
  String _paymentMethod = 'Cash';
  String _orderType = 'Pickup';
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    if (session.isStaff) {
      _orderType = 'Walk-In';
      _paymentMethod = 'Cash';
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _addressCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  bool get _needsCoordinates => _orderType == 'Delivery';

  Future<void> _openMapPicker() async {
    final result = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(
        builder: (_) => MapPickerPage(
          initialAddress: _addressCtrl.text,
          initialLat: _pinnedLat,
          initialLng: _pinnedLng,
        ),
      ),
    );
    if (result != null) {
      final distance = deliveryDistance(
        result['lat'] as double,
        result['lng'] as double,
      );
      setState(() {
        _addressCtrl.text = result['address'] as String;
        _pinnedLat = result['lat'] as double;
        _pinnedLng = result['lng'] as double;
        _locationPinned = true;
        _distance = distance;
      });
    }
  }

  Future<void> _submitOrder() async {
    final name = _nameCtrl.text.trim().isEmpty
        ? (session.isStaff ? 'Walk-in Customer' : '')
        : _nameCtrl.text.trim();
    final phone = _phoneCtrl.text.trim().isEmpty
        ? (session.isStaff ? 'N/A' : '')
        : _phoneCtrl.text.trim();
    final address = _needsCoordinates ? _addressCtrl.text.trim() : _orderType;

    if (name.isEmpty ||
        (_needsCoordinates && address.isEmpty) ||
        (!session.isStaff && phone.isEmpty)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please fill in all required fields!'),
          backgroundColor: KioskTheme.lunaPink,
        ),
      );
      return;
    }
    setState(() => _loading = true);

    final orderNumber = TelegramService.generateOrderNumber();
    final items = List<CartItem>.from(cartNotifier.items);
    final total = cartNotifier.totalPrice;
    final now = DateTime.now();
    final timeStr = localStamp(now);
    final paymentStatus = session.isStaff
        ? 'PAID'
        : (_paymentMethod == 'GCash' ? 'AWAITING_PAYMENT' : 'NOT PAID');

    final result = await OrderService.placeOrder(
      OrderModel(
        orderId: orderNumber,
        items: items
            .map(
              (i) => OrderItem(
                name: i.name,
                variant: i.variant,
                price: i.price,
                quantity: i.quantity,
              ),
            )
            .toList(),
        totalAmount: total,
        timestamp: now,
        dateLabel: phtDateLabel(),
        type: _orderType,
        entryType: session.isStaff ? 'Staff' : 'Kiosk',
        customerName: name,
        customerPhone: phone,
        customerAddress: address,
        lat: _needsCoordinates ? _pinnedLat : null,
        lng: _needsCoordinates ? _pinnedLng : null,
        totalDistance: _needsCoordinates ? _distance : 0.0,
        paymentMethod: _paymentMethod,
        paymentStatus: paymentStatus,
        status: 'Pending',
      ),
      timeStr,
    );

    if (!mounted) return;
    setState(() => _loading = false);

    // Nothing is confirmed until the order is actually persisted.
    if (result.docId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'We could not save your order. Please check the connection and try again.',
          ),
          backgroundColor: KioskTheme.error,
          duration: Duration(seconds: 6),
        ),
      );
      return;
    }

    cartNotifier.clear();
    TelegramService.showTelegramStatus(
      context,
      result.telegramSent,
      orderNumber,
    );

    if (_paymentMethod == 'GCash' && !session.isStaff) {
      final paid = await Navigator.push<bool>(
        context,
        MaterialPageRoute(
          builder: (_) => GCashCheckoutPage(
            orderDocId: result.docId!,
            orderId: orderNumber,
            amount: total,
            items: items
                .map(
                  (i) => {
                    'name': i.name,
                    'variant': i.variant,
                    'price': i.price,
                    'quantity': i.quantity,
                  },
                )
                .toList(),
            customerName: name,
            customerPhone: phone,
          ),
        ),
      );

      if (!mounted) return;
      if (paid == true) {
        _goToReceipt(
          orderNumber,
          name,
          address,
          phone,
          items,
          total,
          timeStr,
          false,
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'GCash payment was cancelled or failed. Your order is saved but not yet paid.',
            ),
            backgroundColor: KioskTheme.error,
            duration: Duration(seconds: 5),
          ),
        );
        Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(builder: (_) => const CheckoutPage()),
          (route) => route.isFirst,
        );
      }
    } else {
      _goToReceipt(
        orderNumber,
        name,
        address,
        phone,
        items,
        total,
        timeStr,
        session.isStaff,
      );
    }
  }

  void _goToReceipt(
    String orderNumber,
    String name,
    String address,
    String phone,
    List<CartItem> items,
    int total,
    String timeStr,
    bool isWalkIn,
  ) {
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(
        builder: (_) => ReceiptPage(
          orderNumber: orderNumber,
          customerName: name,
          customerAddress: address,
          customerPhone: phone,
          items: items,
          total: total,
          timeStr: timeStr,
          isWalkIn: isWalkIn,
          orderType: _orderType,
        ),
      ),
      (route) => route.isFirst,
    );
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final isMobile = width < 600;
    final bottomInset = MediaQuery.paddingOf(context).bottom;

    return Scaffold(
      backgroundColor: KioskTheme.lunaBlushPaper,
      appBar: AppBar(
        title: Text(
          session.isStaff ? 'POS CHECKOUT' : 'CHECKOUT',
          style: KioskTheme.headerSmall.copyWith(
            color: KioskTheme.textOnPrimary,
            letterSpacing: isMobile ? 1.2 : 2,
          ),
        ),
        centerTitle: true,
        backgroundColor: KioskTheme.lunaPink,
        foregroundColor: KioskTheme.textOnPrimary,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          isMobile ? 16 : 32,
          isMobile ? 16 : 32,
          isMobile ? 16 : 32,
          bottomInset + 32,
        ),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildSectionCard(
                  isMobile: isMobile,
                  title: 'ORDER SUMMARY',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      ...cartNotifier.items.map(
                        (item) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Row(
                            children: [
                              Text(
                                '${item.quantity}x',
                                style: KioskTheme.titleMedium.copyWith(
                                  fontSize: 15,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  '${item.name}${item.variant.isNotEmpty ? ' (${item.variant})' : ''}',
                                  style: KioskTheme.bodyLarge.copyWith(
                                    fontSize: 15,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              Text(
                                '₱${item.price * item.quantity}',
                                style: KioskTheme.titleMedium.copyWith(
                                  fontSize: 15,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      KioskTheme.divider(),
                      const SizedBox(height: 16),
                      if (_needsCoordinates) ...[
                        Text(
                          'Delivery fee applies. Your rider will confirm the amount, charged separately from your food order.',
                          style: KioskTheme.bodyMedium.copyWith(fontSize: 14),
                        ),
                        const SizedBox(height: 12),
                      ],
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            _needsCoordinates ? 'FOOD TOTAL' : 'TOTAL',
                            style: KioskTheme.headerSmall.copyWith(
                              letterSpacing: 1.5,
                            ),
                          ),
                          Text(
                            '₱${cartNotifier.totalPrice}',
                            style: KioskTheme.headerLarge.copyWith(
                              fontSize: 32,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 32),
                _buildSectionLabel('ORDER TYPE'),
                const SizedBox(height: 16),
                Row(
                  children: [
                    if (session.isStaff) ...[
                      Expanded(
                        child: _typeBtn(
                          label: 'Walk-In',
                          icon: Icons.point_of_sale_rounded,
                          selected: _orderType == 'Walk-In',
                          onTap: () => setState(() => _orderType = 'Walk-In'),
                        ),
                      ),
                      const SizedBox(width: 16),
                    ],
                    Expanded(
                      child: _typeBtn(
                        label: 'Pickup',
                        icon: Icons.storefront_rounded,
                        selected: _orderType == 'Pickup',
                        onTap: () => setState(() => _orderType = 'Pickup'),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: _typeBtn(
                        label: 'Delivery',
                        icon: Icons.motorcycle_rounded,
                        selected: _orderType == 'Delivery',
                        onTap: () => setState(() => _orderType = 'Delivery'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 32),
                _buildSectionLabel('PAYMENT METHOD'),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: _typeBtn(
                        label: 'Cash',
                        icon: Icons.payments_rounded,
                        selected: _paymentMethod == 'Cash',
                        onTap: () => setState(() => _paymentMethod = 'Cash'),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: _typeBtn(
                        label: 'GCash',
                        icon: Icons.phone_android_rounded,
                        selected: _paymentMethod == 'GCash',
                        onTap: () => setState(() => _paymentMethod = 'GCash'),
                      ),
                    ),
                  ],
                ),
                AnimatedSize(
                  duration: const Duration(milliseconds: 300),
                  child: _paymentMethod == 'Cash'
                      ? const SizedBox.shrink()
                      : Container(
                          margin: const EdgeInsets.only(top: 24),
                          padding: const EdgeInsets.all(24),
                          decoration: BoxDecoration(
                            color: const Color(
                              0xFF007DFE,
                            ).withValues(alpha: 0.05),
                            borderRadius: BorderRadius.circular(
                              KioskTheme.radiusLg,
                            ),
                            border: Border.all(
                              color: const Color(
                                0xFF007DFE,
                              ).withValues(alpha: 0.2),
                            ),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  const Icon(
                                    Icons.payment_rounded,
                                    color: Color(0xFF007DFE),
                                  ),
                                  const SizedBox(width: 12),
                                  Text(
                                    'GCASH VIA PAYMONGO',
                                    style: KioskTheme.labelLarge.copyWith(
                                      color: const Color(0xFF007DFE),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 16),
                              Text(
                                'You will be redirected to a secure GCash checkout page after confirming your order.',
                                style: KioskTheme.bodyLarge.copyWith(
                                  fontSize: 14,
                                ),
                              ),
                              const SizedBox(height: 12),
                              Text(
                                'Select GCash as your payment method in the checkout page and authorize the payment in the GCash app.',
                                style: KioskTheme.bodyMedium.copyWith(
                                  fontSize: 13,
                                  color: KioskTheme.textSecondary,
                                ),
                              ),
                              const SizedBox(height: 12),
                              Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(
                                    KioskTheme.radiusSm,
                                  ),
                                  border: Border.all(
                                    color: const Color(
                                      0xFF007DFE,
                                    ).withValues(alpha: 0.1),
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    const Icon(
                                      Icons.lock_rounded,
                                      size: 16,
                                      color: Color(0xFF007DFE),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Text(
                                        'Secured by PayMongo. Funds settle to the merchant\'s bank account.',
                                        style: KioskTheme.bodySmall.copyWith(
                                          fontSize: 11,
                                          color: KioskTheme.textSecondary,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                ),
                const SizedBox(height: 32),
                Text(
                  _needsCoordinates ? 'DELIVERY DETAILS' : 'CUSTOMER DETAILS',
                  style: KioskTheme.labelLarge.copyWith(fontSize: 16),
                ),
                const SizedBox(height: 16),
                _field(
                  ctrl: _nameCtrl,
                  label: session.isStaff
                      ? 'FULL NAME (OPTIONAL FOR POS)'
                      : 'FULL NAME',
                  icon: Icons.person_rounded,
                  hint: session.isStaff
                      ? 'e.g. Walk-in Customer (Default)'
                      : 'e.g. Juan Dela Cruz',
                ),
                const SizedBox(height: 16),
                AnimatedSize(
                  duration: const Duration(milliseconds: 250),
                  curve: Curves.easeInOut,
                  child: !_needsCoordinates
                      ? const SizedBox.shrink()
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            GestureDetector(
                              onTap: _openMapPicker,
                              child: AnimatedContainer(
                                duration: const Duration(milliseconds: 200),
                                width: double.infinity,
                                padding: const EdgeInsets.symmetric(
                                  vertical: 20,
                                  horizontal: 20,
                                ),
                                decoration: BoxDecoration(
                                  color: _locationPinned
                                      ? KioskTheme.lunaPink.withValues(
                                          alpha: 0.05,
                                        )
                                      : Colors.white,
                                  borderRadius: BorderRadius.circular(
                                    KioskTheme.radiusMd,
                                  ),
                                  border: Border.all(
                                    color: _locationPinned
                                        ? KioskTheme.lunaPink
                                        : Colors.grey[200]!,
                                    width: 2,
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    Icon(
                                      _locationPinned
                                          ? Icons.location_on
                                          : Icons.add_location_alt_outlined,
                                      color: KioskTheme.lunaPink,
                                      size: 24,
                                    ),
                                    const SizedBox(width: 16),
                                    Expanded(
                                      child: Text(
                                        _locationPinned
                                            ? 'Location pinned on map'
                                            : 'Tap to pin your location on map',
                                        style: KioskTheme.font(
                                          color: KioskTheme.lunaPink,
                                          fontSize: 15,
                                          fontWeight: _locationPinned
                                              ? FontWeight.w800
                                              : FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                    const Icon(
                                      Icons.chevron_right,
                                      color: KioskTheme.lunaPink,
                                      size: 20,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            TextField(
                              controller: _addressCtrl,
                              maxLines: 2,
                              style: KioskTheme.font(
                                fontWeight: FontWeight.w600,
                                color: KioskTheme.textPrimary,
                              ),
                              decoration:
                                  KioskTheme.inputDecoration(
                                    hint: 'Address auto-fills from map...',
                                    icon: Icons.edit_location_alt,
                                  ).copyWith(
                                    prefixIcon: const Icon(
                                      Icons.edit_location_alt,
                                      color: KioskTheme.lunaPink,
                                      size: 20,
                                    ),
                                  ),
                            ),
                            const SizedBox(height: 16),
                          ],
                        ),
                ),
                _field(
                  ctrl: _phoneCtrl,
                  label: session.isStaff
                      ? 'CONTACT NUMBER (OPTIONAL FOR POS)'
                      : 'CONTACT NUMBER',
                  icon: Icons.phone_rounded,
                  hint: 'e.g. 09XX XXX XXXX',
                  keyboard: TextInputType.phone,
                ),
                const SizedBox(height: 48),
                Builder(
                  builder: (context) {
                    final isBlocked = _needsCoordinates && !_locationPinned;
                    final label = _orderType == 'Walk-In'
                        ? 'CONFIRM POS ORDER'
                        : (_orderType == 'Pickup'
                              ? 'CONFIRM PICKUP ORDER'
                              : 'PLACE DELIVERY ORDER');

                    return JuicyFeedback(
                      onPressed: (_loading || isBlocked) ? null : _submitOrder,
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(vertical: 24),
                        decoration: BoxDecoration(
                          color: (_loading || isBlocked)
                              ? Colors.grey[400]
                              : KioskTheme.lunaPink,
                          borderRadius: BorderRadius.circular(
                            KioskTheme.radiusFull,
                          ),
                          boxShadow: (_loading || isBlocked)
                              ? []
                              : KioskTheme.shadowPrimary,
                        ),
                        child: Center(
                          child: _loading
                              ? const SizedBox(
                                  width: 24,
                                  height: 24,
                                  child: CircularProgressIndicator.adaptive(
                                    valueColor: AlwaysStoppedAnimation<Color>(
                                      Colors.white,
                                    ),
                                    strokeWidth: 2.5,
                                  ),
                                )
                              : Text(
                                  label,
                                  style: KioskTheme.labelLarge.copyWith(
                                    color: KioskTheme.textOnPrimary,
                                    fontSize: isMobile ? 16 : 18,
                                  ),
                                ),
                        ),
                      ),
                    );
                  },
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildSectionCard({
    required String title,
    required Widget child,
    bool isMobile = false,
  }) {
    return Container(
      padding: EdgeInsets.all(isMobile ? 16 : 24),
      decoration: KioskTheme.cardWhite,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: KioskTheme.labelLarge.copyWith(fontSize: 16)),
          SizedBox(height: isMobile ? 14 : 20),
          child,
        ],
      ),
    );
  }

  Widget _buildSectionLabel(String text) {
    return Text(text, style: KioskTheme.labelLarge.copyWith(fontSize: 16));
  }

  Widget _typeBtn({
    required String label,
    required IconData icon,
    required bool selected,
    required VoidCallback onTap,
  }) {
    final isMobile = MediaQuery.sizeOf(context).width < 600;
    return JuicyFeedback(
      onPressed: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: EdgeInsets.symmetric(
          vertical: isMobile ? 14 : 20,
          horizontal: 6,
        ),
        decoration: BoxDecoration(
          color: selected ? KioskTheme.lunaPink : Colors.white,
          borderRadius: BorderRadius.circular(KioskTheme.radiusLg),
          border: Border.all(
            color: selected ? KioskTheme.lunaPink : Colors.grey[200]!,
            width: 2,
          ),
        ),
        child: Column(
          children: [
            Icon(
              icon,
              size: isMobile ? 26 : 32,
              color: selected ? Colors.white : KioskTheme.lunaPink,
            ),
            const SizedBox(height: 8),
            FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                label.toUpperCase(),
                style: KioskTheme.font(
                  color: selected ? Colors.white : KioskTheme.lunaPink,
                  fontWeight: FontWeight.w800,
                  fontSize: isMobile ? 12 : 14,
                  letterSpacing: isMobile ? 0.8 : 2,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _field({
    required TextEditingController ctrl,
    required String label,
    required IconData icon,
    required String hint,
    TextInputType keyboard = TextInputType.text,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: KioskTheme.labelLarge.copyWith(fontSize: 13)),
        const SizedBox(height: 8),
        TextField(
          controller: ctrl,
          keyboardType: keyboard,
          style: KioskTheme.font(
            fontWeight: FontWeight.w600,
            color: KioskTheme.textPrimary,
          ),
          decoration: KioskTheme.inputDecoration(hint: hint, icon: icon),
        ),
      ],
    );
  }
}
