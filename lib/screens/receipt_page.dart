import 'package:flutter/material.dart';
import '../models/cart.dart';
import '../widgets/kiosk/kiosk_theme.dart';

class ReceiptPage extends StatelessWidget {
  final String orderNumber,
      customerName,
      customerAddress,
      customerPhone,
      timeStr,
      orderType;
  final List<CartItem> items;
  final int total;
  final int deliveryFee;
  final bool isWalkIn;
  const ReceiptPage({
    super.key,
    required this.orderNumber,
    required this.customerName,
    required this.customerAddress,
    required this.customerPhone,
    required this.items,
    required this.total,
    required this.timeStr,
    required this.isWalkIn,
    required this.orderType,
    this.deliveryFee = 0,
  });

  bool get _isPickup => orderType == 'Pickup';

  @override
  Widget build(BuildContext context) {
    final isMobile = MediaQuery.sizeOf(context).width < 600;
    final bottomInset = MediaQuery.paddingOf(context).bottom;

    return Scaffold(
      backgroundColor: KioskTheme.lunaBlush,
      appBar: AppBar(
        title: Text(
          'RECEIPT',
          style: KioskTheme.headerSmall.copyWith(
            letterSpacing: isMobile ? 1.2 : 2,
          ),
        ),
        centerTitle: true,
        backgroundColor: Colors.transparent,
        foregroundColor: KioskTheme.lunaPink,
        elevation: 0,
        automaticallyImplyLeading: false,
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
              children: [
                Container(
                  width: double.infinity,
                  padding: EdgeInsets.symmetric(
                    vertical: isMobile ? 28 : 40,
                    horizontal: isMobile ? 16 : 24,
                  ),
                  decoration: KioskTheme.cardPink,
                  child: Column(
                    children: [
                      Container(
                        width: 80,
                        height: 80,
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.1),
                          shape: BoxShape.circle,
                        ),
                        child: const Center(
                          child: Icon(
                            Icons.check_rounded,
                            color: Colors.white,
                            size: 48,
                          ),
                        ),
                      ),
                      const SizedBox(height: 24),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          isWalkIn
                              ? 'ORDER COMPLETE'
                              : _isPickup
                              ? 'PICKUP CONFIRMED!'
                              : 'ORDER PLACED!',
                          style: KioskTheme.font(
                            color: Colors.white,
                            fontSize: isMobile ? 22 : 26,
                            fontWeight: FontWeight.w800,
                            letterSpacing: isMobile ? 1 : 1.5,
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        isWalkIn
                            ? 'Thank you for dining with us!'
                            : _isPickup
                            ? 'Your order will be ready for pickup soon.'
                            : 'We are preparing your delivery now!',
                        style: KioskTheme.font(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.w500,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 32),
                Container(
                  width: double.infinity,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(KioskTheme.radiusXl),
                    boxShadow: KioskTheme.shadowLg,
                  ),
                  child: Column(
                    children: [
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(vertical: 32),
                        decoration: BoxDecoration(
                          color: KioskTheme.lunaButter.withValues(alpha: 0.3),
                          borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(KioskTheme.radiusXl),
                          ),
                        ),
                        child: Column(
                          children: [
                            FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text(
                                'LUNA BITES & DELIGHTS',
                                style: KioskTheme.headerMedium.copyWith(
                                  letterSpacing: 4,
                                ),
                              ),
                            ),
                            const SizedBox(height: 20),
                            Container(
                              padding: EdgeInsets.symmetric(
                                horizontal: isMobile ? 16 : 24,
                                vertical: 10,
                              ),
                              decoration: KioskTheme.badgePink,
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(
                                  'ORDER # $orderNumber',
                                  style: KioskTheme.font(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w800,
                                    fontSize: isMobile ? 16 : 20,
                                    letterSpacing: isMobile ? 1 : 2,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      Padding(
                        padding: EdgeInsets.all(isMobile ? 18 : 32),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (!isWalkIn) ...[
                              _row(
                                'FULL NAME',
                                customerName,
                                isMobile: isMobile,
                              ),
                              const SizedBox(height: 12),
                              if (!_isPickup) ...[
                                _row(
                                  'ADDRESS',
                                  customerAddress,
                                  isMobile: isMobile,
                                ),
                                const SizedBox(height: 12),
                              ],
                              _row('PHONE', customerPhone, isMobile: isMobile),
                              const SizedBox(height: 12),
                            ],
                            _row('TIME', timeStr, isMobile: isMobile),
                            const SizedBox(height: 24),
                            KioskTheme.divider(),
                            const SizedBox(height: 24),
                            Text(
                              'ITEMS ORDERED',
                              style: KioskTheme.labelMedium.copyWith(
                                color: KioskTheme.textMuted,
                                fontSize: 14,
                              ),
                            ),
                            const SizedBox(height: 16),
                            ...items.map(
                              (item) => Padding(
                                padding: const EdgeInsets.only(bottom: 16),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      '${item.quantity}x',
                                      style: KioskTheme.titleMedium.copyWith(
                                        fontSize: 16,
                                      ),
                                    ),
                                    const SizedBox(width: 16),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            item.name,
                                            style: KioskTheme.titleLarge
                                                .copyWith(fontSize: 16),
                                          ),
                                          if (item.variant.isNotEmpty)
                                            Text(
                                              item.variant,
                                              style: KioskTheme.bodySmall,
                                            ),
                                        ],
                                      ),
                                    ),
                                    Text(
                                      '\u20B1${item.price * item.quantity}',
                                      style: KioskTheme.titleMedium.copyWith(
                                        fontSize: 16,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            KioskTheme.divider(),
                            const SizedBox(height: 32),
                            if (orderType == 'Delivery') ...[
                              Text(
                                'Delivery fee applies. Your rider will confirm the amount, charged separately from your food order.',
                                style: KioskTheme.bodyMedium,
                              ),
                              const SizedBox(height: 12),
                            ],
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    orderType == 'Delivery'
                                        ? 'FOOD TOTAL'
                                        : 'GRAND TOTAL',
                                    style: KioskTheme.headerSmall.copyWith(
                                      letterSpacing: 1,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Text(
                                  '\u20B1$total',
                                  style: KioskTheme.headerLarge.copyWith(
                                    fontSize: isMobile ? 28 : 36,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 32),
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(20),
                              decoration: BoxDecoration(
                                color: KioskTheme.lunaButter.withValues(
                                  alpha: 0.1,
                                ),
                                borderRadius: BorderRadius.circular(
                                  KioskTheme.radiusMd,
                                ),
                                border: Border.all(
                                  color: KioskTheme.lunaButter.withValues(
                                    alpha: 0.5,
                                  ),
                                ),
                              ),
                              child: Center(
                                child: Text(
                                  isWalkIn
                                      ? 'Please show this to the staff.'
                                      : _isPickup
                                      ? 'Please pick up your order at the counter.'
                                      : 'Screenshot this for your records!',
                                  style: KioskTheme.bodyLarge.copyWith(
                                    fontSize: 14,
                                  ),
                                  textAlign: TextAlign.center,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(height: isMobile ? 28 : 40),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () =>
                        Navigator.of(context).popUntil((r) => r.isFirst),
                    style: FilledButton.styleFrom(
                      backgroundColor: KioskTheme.lunaPink,
                      foregroundColor: KioskTheme.textOnPrimary,
                      minimumSize: const Size(48, 54),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(
                          KioskTheme.radiusMd,
                        ),
                      ),
                    ),
                    child: Text(
                      isWalkIn ? 'NEW WALK-IN ORDER' : 'ORDER AGAIN',
                      style: KioskTheme.font(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: isMobile ? 16 : 18,
                        letterSpacing: 1.5,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _row(String label, String value, {bool isMobile = false}) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SizedBox(
        width: isMobile ? 84 : 100,
        child: Text(
          label,
          style: KioskTheme.labelMedium.copyWith(color: KioskTheme.textMuted),
        ),
      ),
      SizedBox(width: isMobile ? 10 : 16),
      Expanded(
        child: Text(value, style: KioskTheme.bodyLarge.copyWith(fontSize: 14)),
      ),
    ],
  );
}
