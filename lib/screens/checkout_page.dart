import 'package:flutter/material.dart';
import '../widgets/kiosk/kiosk_theme.dart';
import '../widgets/kiosk/juicy_feedback.dart';
import '../models/cart.dart';
import '../models/order.dart';
import '../services/cart_notifier.dart';
import '../services/delivery.dart';
import '../services/inactivity_timer.dart';
import '../services/telegram_service.dart';
import '../services/order_service.dart';
import '../services/order_policy.dart';
import '../services/session.dart';
import '../utils/format.dart';
import '../utils/validate.dart';
import 'map_picker_page.dart' deferred as map_picker;
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
  String? _pendingOrderDocId;
  String? _pendingOrderNumber;

  @override
  void initState() {
    super.initState();
    // The map (flutter_map + tiles code) is a separate JS part on web;
    // start fetching it now so it is ready when Delivery needs a pin.
    _mapPickerReady = map_picker.loadLibrary()..ignore();
    if (session.isStaff) {
      _orderType = 'Walk-In';
      _paymentMethod = 'Cash';
    }
    for (final ctrl in [_nameCtrl, _addressCtrl, _phoneCtrl]) {
      ctrl.addListener(_clearPendingOrder);
    }
  }

  void _clearPendingOrder() {
    if (_pendingOrderDocId != null || _pendingOrderNumber != null) {
      _pendingOrderDocId = null;
      _pendingOrderNumber = null;
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

  late Future<void> _mapPickerReady;

  Future<void> _openMapPicker() async {
    try {
      await _mapPickerReady;
    } catch (_) {
      _mapPickerReady = map_picker.loadLibrary()..ignore(); // retry next tap
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Could not open the map. Check the connection and tap again.',
          ),
          backgroundColor: KioskTheme.error,
        ),
      );
      return;
    }
    if (!mounted) return;
    final result = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(
        builder: (_) => map_picker.MapPickerPage(
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
    if (cartNotifier.items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Your order slip is empty. Please add items first.'),
          backgroundColor: KioskTheme.lunaPink,
        ),
      );
      return;
    }

    final name = _nameCtrl.text.trim().isEmpty
        ? (session.isStaff ? 'Walk-in Customer' : '')
        : _nameCtrl.text.trim();
    final phone = _phoneCtrl.text.trim().isEmpty
        ? (session.isStaff ? 'N/A' : '')
        : _phoneCtrl.text.trim();
    final address = _needsCoordinates ? _addressCtrl.text.trim() : _orderType;

    String? validationError;
    if (!session.isStaff) {
      validationError = V.name(name) ?? V.phone(phone);
    }
    validationError ??= OrderPolicy.rejectionFor(
      customerName: name,
      itemCount: cartNotifier.items.length,
    );
    if (validationError == null && _needsCoordinates && address.isEmpty) {
      validationError = 'Please pin your delivery address on the map.';
    }

    if (validationError != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(validationError),
          backgroundColor: KioskTheme.lunaPink,
        ),
      );
      return;
    }
    setState(() => _loading = true);

    final items = List<CartItem>.from(cartNotifier.items);
    final total = cartNotifier.totalPrice;
    final now = DateTime.now();
    final timeStr = localStamp(now);
    final statuses = OrderPolicy.statusesFor(
      isStaff: session.isStaff,
      paymentMethod: _paymentMethod,
    );

    String? orderDocId = _pendingOrderDocId;
    String orderNumber =
        _pendingOrderNumber ?? TelegramService.generateOrderNumber();
    var telegramSent = true;

    if (orderDocId == null || _paymentMethod != 'GCash') {
      orderNumber = TelegramService.generateOrderNumber();
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
          entryType: statuses.entryType,
          customerName: name,
          customerPhone: phone,
          customerAddress: address,
          lat: _needsCoordinates ? _pinnedLat : null,
          lng: _needsCoordinates ? _pinnedLng : null,
          totalDistance: _needsCoordinates ? _distance : 0.0,
          paymentMethod: _paymentMethod,
          paymentStatus: statuses.paymentStatus,
          status: statuses.status,
        ),
        timeStr,
      );
      orderDocId = result.docId;
      telegramSent = result.telegramSent;
    }

    if (!mounted) return;
    setState(() => _loading = false);

    // Nothing is confirmed until the order is actually persisted.
    if (orderDocId == null) {
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

    if (_paymentMethod == 'GCash' && !session.isStaff) {
      _pendingOrderDocId = orderDocId;
      _pendingOrderNumber = orderNumber;
      final paid = await Navigator.push<bool>(
        context,
        MaterialPageRoute(
          builder: (_) => GCashCheckoutPage(
            orderDocId: orderDocId!,
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
        _pendingOrderDocId = null;
        _pendingOrderNumber = null;
        cartNotifier.clear();
        TelegramService.showTelegramStatus(context, telegramSent, orderNumber);
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
              'GCash payment was cancelled or failed. Your order is saved — tap to retry payment.',
            ),
            backgroundColor: KioskTheme.error,
            duration: Duration(seconds: 5),
          ),
        );
      }
    } else {
      cartNotifier.clear();
      TelegramService.showTelegramStatus(context, telegramSent, orderNumber);
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

    return InactivityWatcher(
      child: Scaffold(
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
        body: cartNotifier.items.isEmpty
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.shopping_bag_outlined,
                        size: 64,
                        color: KioskTheme.lunaPink.withValues(alpha: 0.4),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        'Your order slip is empty',
                        style: KioskTheme.headerMedium,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed: () => Navigator.pushNamedAndRemoveUntil(
                          context,
                          '/menu',
                          (r) => false,
                        ),
                        child: const Text('Browse the menu'),
                      ),
                    ],
                  ),
                ),
              )
            : SingleChildScrollView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                padding: EdgeInsets.fromLTRB(
                  isMobile ? 16 : 32,
                  isMobile ? 16 : 32,
                  isMobile ? 16 : 32,
                  bottomInset + (isMobile ? 24 : 32),
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
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
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
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                          style: KioskTheme.bodyLarge.copyWith(
                                            fontSize: 15,
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      Text(
                                        '₱${item.price * item.quantity}',
                                        style: KioskTheme.titleMedium.copyWith(
                                          fontSize: 15,
                                          fontFeatures: const [
                                            FontFeature.tabularFigures(),
                                          ],
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
                                  style: KioskTheme.bodyMedium.copyWith(
                                    fontSize: 14,
                                  ),
                                ),
                                const SizedBox(height: 12),
                              ],
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
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
                                      fontSize: isMobile ? 28 : 32,
                                      fontFeatures: const [
                                        FontFeature.tabularFigures(),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        SizedBox(height: isMobile ? 20 : 32),
                        _buildSectionLabel('ORDER TYPE'),
                        SizedBox(height: isMobile ? 12 : 16),
                        Row(
                          children: [
                            if (session.isStaff) ...[
                              Expanded(
                                child: _typeBtn(
                                  label: 'Walk-In',
                                  icon: Icons.point_of_sale_rounded,
                                  selected: _orderType == 'Walk-In',
                                  onTap: () => setState(() {
                                    _orderType = 'Walk-In';
                                    _clearPendingOrder();
                                  }),
                                ),
                              ),
                              SizedBox(width: isMobile ? 10 : 16),
                            ],
                            Expanded(
                              child: _typeBtn(
                                label: 'Pickup',
                                icon: Icons.storefront_rounded,
                                selected: _orderType == 'Pickup',
                                onTap: () => setState(() {
                                  _orderType = 'Pickup';
                                  _clearPendingOrder();
                                }),
                              ),
                            ),
                            SizedBox(width: isMobile ? 10 : 16),
                            Expanded(
                              child: _typeBtn(
                                label: 'Delivery',
                                icon: Icons.motorcycle_rounded,
                                selected: _orderType == 'Delivery',
                                onTap: () => setState(() {
                                  _orderType = 'Delivery';
                                  _clearPendingOrder();
                                }),
                              ),
                            ),
                          ],
                        ),
                        SizedBox(height: isMobile ? 20 : 32),
                        _buildSectionLabel('PAYMENT METHOD'),
                        SizedBox(height: isMobile ? 12 : 16),
                        Row(
                          children: [
                            Expanded(
                              child: _typeBtn(
                                label: 'Cash',
                                icon: Icons.payments_rounded,
                                selected: _paymentMethod == 'Cash',
                                onTap: () => setState(() {
                                  _paymentMethod = 'Cash';
                                  _clearPendingOrder();
                                }),
                              ),
                            ),
                            SizedBox(width: isMobile ? 10 : 16),
                            Expanded(
                              child: _typeBtn(
                                label: 'GCash',
                                icon: Icons.phone_android_rounded,
                                selected: _paymentMethod == 'GCash',
                                onTap: () =>
                                    setState(() => _paymentMethod = 'GCash'),
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
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
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
                                            style: KioskTheme.labelLarge
                                                .copyWith(
                                                  color: const Color(
                                                    0xFF007DFE,
                                                  ),
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
                                                style: KioskTheme.bodySmall
                                                    .copyWith(
                                                      fontSize: 11,
                                                      color: KioskTheme
                                                          .textSecondary,
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
                        SizedBox(height: isMobile ? 20 : 32),
                        Text(
                          _needsCoordinates
                              ? 'DELIVERY DETAILS'
                              : 'CUSTOMER DETAILS',
                          style: KioskTheme.labelLarge.copyWith(fontSize: 16),
                        ),
                        const SizedBox(height: 14),
                        _field(
                          ctrl: _nameCtrl,
                          label: session.isStaff
                              ? 'FULL NAME (OPTIONAL FOR POS)'
                              : 'FULL NAME',
                          icon: Icons.person_rounded,
                          hint: session.isStaff
                              ? 'e.g. Walk-in Customer (Default)'
                              : 'e.g. Juan Dela Cruz',
                          textCapitalization: TextCapitalization.words,
                          textInputAction: TextInputAction.next,
                          autofillHints: const [AutofillHints.name],
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
                                    Semantics(
                                      button: true,
                                      label: _locationPinned
                                          ? 'Location pinned on map, tap to change'
                                          : 'Tap to pin your location on map',
                                      child: Material(
                                        color: _locationPinned
                                            ? KioskTheme.lunaBlushPaper
                                            : Colors.white,
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(
                                            KioskTheme.radiusMd,
                                          ),
                                          side: BorderSide(
                                            color: _locationPinned
                                                ? KioskTheme.lunaPink
                                                : KioskTheme.rule,
                                            width: 2,
                                          ),
                                        ),
                                        clipBehavior: Clip.antiAlias,
                                        child: InkWell(
                                          onTap: _openMapPicker,
                                          child: Container(
                                            width: double.infinity,
                                            padding: const EdgeInsets.symmetric(
                                              vertical: 16,
                                              horizontal: 16,
                                            ),
                                            child: Row(
                                              children: [
                                                Icon(
                                                  _locationPinned
                                                      ? Icons.location_on
                                                      : Icons
                                                            .add_location_alt_outlined,
                                                  color: KioskTheme.pinkInk,
                                                  size: 24,
                                                ),
                                                const SizedBox(width: 14),
                                                Expanded(
                                                  child: Text(
                                                    _locationPinned
                                                        ? 'Location pinned on map'
                                                        : 'Tap to pin your location on map',
                                                    style: KioskTheme.font(
                                                      color: KioskTheme.pinkInk,
                                                      fontSize: 15,
                                                      fontWeight:
                                                          _locationPinned
                                                          ? FontWeight.w800
                                                          : FontWeight.w600,
                                                    ),
                                                  ),
                                                ),
                                                const Icon(
                                                  Icons.chevron_right,
                                                  color: KioskTheme.pinkInk,
                                                  size: 20,
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(height: 12),
                                    TextField(
                                      controller: _addressCtrl,
                                      maxLines: 2,
                                      textCapitalization:
                                          TextCapitalization.sentences,
                                      textInputAction: TextInputAction.next,
                                      autofillHints: const [
                                        AutofillHints.fullStreetAddress,
                                      ],
                                      style: KioskTheme.font(
                                        fontWeight: FontWeight.w600,
                                        color: KioskTheme.textPrimary,
                                      ),
                                      decoration:
                                          KioskTheme.inputDecoration(
                                            hint:
                                                'Address auto-fills from map...',
                                            icon: Icons.edit_location_alt,
                                          ).copyWith(
                                            prefixIcon: const Icon(
                                              Icons.edit_location_alt,
                                              color: KioskTheme.pinkInk,
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
                          textInputAction: TextInputAction.done,
                          autofillHints: const [AutofillHints.telephoneNumber],
                        ),
                        SizedBox(height: isMobile ? 28 : 40),
                        Builder(
                          builder: (context) {
                            final isBlocked =
                                _needsCoordinates && !_locationPinned;
                            final label = _orderType == 'Walk-In'
                                ? 'CONFIRM POS ORDER'
                                : (_orderType == 'Pickup'
                                      ? 'CONFIRM PICKUP ORDER'
                                      : 'PLACE DELIVERY ORDER');

                            return JuicyFeedback(
                              child: SizedBox(
                                width: double.infinity,
                                child: FilledButton(
                                  onPressed: (_loading || isBlocked)
                                      ? null
                                      : _submitOrder,
                                  style: FilledButton.styleFrom(
                                    backgroundColor: KioskTheme.lunaPink,
                                    foregroundColor: KioskTheme.textOnPrimary,
                                    disabledBackgroundColor: _loading
                                        ? KioskTheme.lunaPink
                                        : KioskTheme.lunaBlushPaper,
                                    disabledForegroundColor: _loading
                                        ? KioskTheme.textOnPrimary
                                        : KioskTheme.textSecondary,
                                    minimumSize: const Size(48, 54),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(
                                        KioskTheme.radiusMd,
                                      ),
                                    ),
                                  ),
                                  child: _loading
                                      ? const SizedBox(
                                          width: 24,
                                          height: 24,
                                          child:
                                              CircularProgressIndicator.adaptive(
                                                valueColor:
                                                    AlwaysStoppedAnimation<
                                                      Color
                                                    >(Colors.white),
                                                strokeWidth: 2.5,
                                              ),
                                        )
                                      : Text(
                                          label,
                                          style: KioskTheme.labelLarge.copyWith(
                                            color: isBlocked
                                                ? KioskTheme.textSecondary
                                                : KioskTheme.textOnPrimary,
                                            fontSize: isMobile ? 15 : 17,
                                          ),
                                        ),
                                ),
                              ),
                            );
                          },
                        ),
                        const SizedBox(height: 16),
                      ],
                    ),
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
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: JuicyFeedback(
        child: Material(
          color: selected ? KioskTheme.lunaPink : Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(KioskTheme.radiusLg),
            side: BorderSide(
              color: selected ? KioskTheme.lunaPink : KioskTheme.rule,
              width: 2,
            ),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: EdgeInsets.symmetric(
                vertical: isMobile ? 14 : 20,
                horizontal: 6,
              ),
              child: Column(
                children: [
                  Icon(
                    icon,
                    size: isMobile ? 24 : 30,
                    color: selected ? Colors.white : KioskTheme.pinkInk,
                  ),
                  const SizedBox(height: 6),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      label.toUpperCase(),
                      style: KioskTheme.font(
                        color: selected ? Colors.white : KioskTheme.pinkInk,
                        fontWeight: FontWeight.w800,
                        fontSize: isMobile ? 12 : 14,
                        letterSpacing: isMobile ? 0.6 : 1.5,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
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
    TextInputAction textInputAction = TextInputAction.next,
    TextCapitalization textCapitalization = TextCapitalization.none,
    Iterable<String>? autofillHints,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: KioskTheme.labelLarge.copyWith(fontSize: 13)),
        const SizedBox(height: 8),
        TextField(
          controller: ctrl,
          keyboardType: keyboard,
          textInputAction: textInputAction,
          textCapitalization: textCapitalization,
          autofillHints: autofillHints,
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
