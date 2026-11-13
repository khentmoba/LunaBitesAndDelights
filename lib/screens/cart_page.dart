import 'package:flutter/material.dart';
import '../models/cart.dart';
import '../services/cart_notifier.dart';
import '../services/session.dart';
import '../services/inactivity_timer.dart';
import '../widgets/kiosk/kiosk_theme.dart';
import '../widgets/kiosk/juicy_feedback.dart';

class KioskCartPage extends StatelessWidget {
  const KioskCartPage({super.key});

  @override
  Widget build(BuildContext context) {
    final isMobile = MediaQuery.of(context).size.width < 700;

    return InactivityWatcher(
      child: Scaffold(
        backgroundColor: KioskTheme.lunaBlush,
        appBar: AppBar(
          title: Text(
            'Your order',
            style: KioskTheme.headerSmall.copyWith(
              letterSpacing: isMobile ? 1 : 2,
            ),
          ),
          centerTitle: true,
          backgroundColor: Colors.transparent,
          elevation: 0,
          leading: IconButton(
            tooltip: 'Back',
            icon: Icon(
              Icons.adaptive.arrow_back,
              color: KioskTheme.lunaPink,
              size: isMobile ? 20 : 24,
            ),
            onPressed: () => Navigator.pop(context),
          ),
          actions: [
            ListenableBuilder(
              listenable: cartNotifier,
              builder: (context, _) {
                if (cartNotifier.items.isEmpty) return const SizedBox.shrink();
                return TextButton(
                  onPressed: () {
                    cartNotifier.clear();
                    kioskSession.reset();
                    Navigator.of(
                      context,
                    ).pushNamedAndRemoveUntil('/', (route) => false);
                  },
                  child: Text(
                    'Cancel order',
                    style: KioskTheme.font(
                      color: KioskTheme.error,
                      fontWeight: FontWeight.w800,
                      fontSize: isMobile ? 11 : 13,
                      letterSpacing: 1,
                    ),
                  ),
                );
              },
            ),
            const SizedBox(width: 8),
          ],
        ),
        body: ListenableBuilder(
          listenable: cartNotifier,
          builder: (context, _) {
            if (cartNotifier.items.isEmpty) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 40),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.shopping_cart_outlined,
                        size: isMobile ? 60 : 100,
                        color: KioskTheme.lunaPink.withValues(alpha: 0.3),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        'Your order slip is empty',
                        textAlign: TextAlign.center,
                        style: KioskTheme.headerMedium.copyWith(
                          fontSize: isMobile ? 18 : 24,
                        ),
                      ),
                      SizedBox(height: isMobile ? 24 : 32),
                      ElevatedButton(
                        onPressed: () => Navigator.pop(context),
                        style: KioskTheme.primaryButton.copyWith(
                          padding: WidgetStateProperty.all(
                            EdgeInsets.symmetric(
                              horizontal: isMobile ? 32 : 40,
                              vertical: isMobile ? 16 : 20,
                            ),
                          ),
                        ),
                        child: Text(
                          'Browse the menu',
                          style: KioskTheme.font(fontWeight: FontWeight.w800),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }

            return Column(
              children: [
                Expanded(
                  child: SingleChildScrollView(
                    padding: EdgeInsets.fromLTRB(
                      isMobile ? 14 : 32,
                      isMobile ? 16 : 32,
                      isMobile ? 14 : 32,
                      24,
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 760),
                        child: _buildSlip(context, isMobile),
                      ),
                    ),
                  ),
                ),
                Container(
                  padding: EdgeInsets.fromLTRB(
                    isMobile ? 20 : 60,
                    isMobile ? 24 : 40,
                    isMobile ? 20 : 60,
                    isMobile
                        ? (MediaQuery.of(context).padding.bottom + 20)
                        : 60,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: const Border(
                      top: BorderSide(color: KioskTheme.lunaLogoPink, width: 2),
                    ),
                    boxShadow: KioskTheme.shadowLg,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'TOTAL',
                            style: KioskTheme.labelMedium.copyWith(
                              fontSize: isMobile ? 14 : 18,
                              color: KioskTheme.textMuted,
                            ),
                          ),
                          Text(
                            '\u20B1${cartNotifier.totalPrice}',
                            style: KioskTheme.displayMedium.copyWith(
                              fontSize: isMobile ? 32 : 48,
                            ),
                          ),
                        ],
                      ),
                      SizedBox(height: isMobile ? 20 : 40),
                      if (isMobile)
                        Column(
                          children: [
                            _buildMobileAction(
                              context,
                              'Checkout',
                              onPressed: () => Navigator.pushNamed(
                                context,
                                '/checkout_process',
                              ),
                              isPrimary: true,
                            ),
                            const SizedBox(height: 10),
                            _buildMobileAction(
                              context,
                              'Add more food',
                              onPressed: () => Navigator.pop(context),
                              isPrimary: false,
                            ),
                          ],
                        )
                      else
                        Row(
                          children: [
                            Expanded(
                              child: JuicyFeedback(
                                child: OutlinedButton(
                                  onPressed: () => Navigator.pop(context),
                                  style: OutlinedButton.styleFrom(
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 24,
                                    ),
                                    side: const BorderSide(
                                      color: KioskTheme.pinkInk,
                                      width: 2,
                                    ),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(
                                        KioskTheme.radiusFull,
                                      ),
                                    ),
                                  ),
                                  child: Text(
                                    'Add more food',
                                    style: KioskTheme.titleLarge.copyWith(
                                      color: KioskTheme.pinkInk,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 24),
                            Expanded(
                              child: JuicyFeedback(
                                child: ElevatedButton(
                                  onPressed: () => Navigator.pushNamed(
                                    context,
                                    '/checkout_process',
                                  ),
                                  style: KioskTheme.primaryButton.copyWith(
                                    padding: WidgetStateProperty.all(
                                      const EdgeInsets.symmetric(vertical: 24),
                                    ),
                                  ),
                                  child: Text(
                                    'Checkout',
                                    style: KioskTheme.font(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildMobileAction(
    BuildContext context,
    String label, {
    required VoidCallback onPressed,
    bool isPrimary = false,
  }) {
    return JuicyFeedback(
      child: SizedBox(
        width: double.infinity,
        child: ElevatedButton(
          onPressed: onPressed,
          style: ElevatedButton.styleFrom(
            backgroundColor: isPrimary ? KioskTheme.lunaPink : Colors.white,
            foregroundColor: isPrimary
                ? KioskTheme.textOnPrimary
                : KioskTheme.pinkInk,
            padding: const EdgeInsets.symmetric(vertical: 18),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(KioskTheme.radiusFull),
              side: isPrimary
                  ? BorderSide.none
                  : const BorderSide(color: KioskTheme.pinkInk, width: 2),
            ),
            elevation: 0,
          ),
          child: Text(
            label,
            style: KioskTheme.font(fontSize: 16, fontWeight: FontWeight.w800),
          ),
        ),
      ),
    );
  }

  /// The order slip: printed column heads, then one ruled line per item.
  Widget _buildSlip(BuildContext context, bool isMobile) {
    final items = cartNotifier.items;
    return Container(
      padding: EdgeInsets.fromLTRB(
        isMobile ? 16 : 28,
        isMobile ? 18 : 26,
        isMobile ? 16 : 28,
        isMobile ? 8 : 14,
      ),
      decoration: BoxDecoration(
        color: KioskTheme.lunaPaper,
        borderRadius: BorderRadius.circular(KioskTheme.radiusSm),
        boxShadow: KioskTheme.shadowMd,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Text(
                  'Order slip',
                  style: KioskTheme.headerLarge.copyWith(
                    color: KioskTheme.lunaLogoPink,
                    fontSize: isMobile ? 28 : 34,
                  ),
                ),
              ),
              Text(
                '${cartNotifier.totalCount} '
                '${cartNotifier.totalCount == 1 ? 'item' : 'items'}',
                style: KioskTheme.hand(fontSize: isMobile ? 22 : 26),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Container(
            height: 4,
            decoration: const BoxDecoration(
              border: Border(
                top: BorderSide(color: KioskTheme.lunaLogoPink),
                bottom: BorderSide(color: KioskTheme.lunaLogoPink),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(0, 14, 0, 6),
            child: Row(
              children: [
                Expanded(child: Text('ITEM', style: KioskTheme.labelMedium)),
                Text('AMOUNT', style: KioskTheme.labelMedium),
              ],
            ),
          ),
          const Divider(
            height: 2,
            thickness: 2,
            color: KioskTheme.lunaLogoPink,
          ),
          for (final item in items)
            Dismissible(
              key: Key(item.id),
              direction: DismissDirection.endToStart,
              background: Container(
                alignment: Alignment.centerRight,
                padding: const EdgeInsets.only(right: 16),
                color: KioskTheme.error,
                child: const Icon(
                  Icons.delete_outline_rounded,
                  color: Colors.white,
                  size: 26,
                  semanticLabel: 'Remove',
                ),
              ),
              onDismissed: (_) => cartNotifier.remove(item.id),
              child: _buildSlipRow(item, isMobile),
            ),
          if (isMobile)
            Padding(
              padding: const EdgeInsets.only(top: 10, bottom: 6),
              child: Text(
                'Swipe a line left to remove it.',
                style: KioskTheme.bodySmall,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildSlipRow(CartItem item, bool isMobile) {
    final imageSize = isMobile ? 52.0 : 72.0;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: const BoxDecoration(
        color: KioskTheme.lunaPaper,
        border: Border(bottom: BorderSide(color: KioskTheme.rule)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              color: Colors.white,
              boxShadow: KioskTheme.shadowSm,
            ),
            child: Image.asset(
              item.imageUrl.isNotEmpty
                  ? item.imageUrl
                  : 'images/placeholder.png',
              width: imageSize,
              height: imageSize,
              fit: BoxFit.cover,
              excludeFromSemantics: true,
            ),
          ),
          SizedBox(width: isMobile ? 12 : 18),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: KioskTheme.titleMedium.copyWith(
                    fontSize: isMobile ? 15 : 17,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (item.variant.isNotEmpty)
                  Text(
                    item.variant,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: KioskTheme.bodySmall.copyWith(fontSize: 13),
                  ),
                const SizedBox(height: 6),
                _buildStepper(item),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Text(
            '\u20B1${item.price * item.quantity}',
            style: KioskTheme.headerSmall.copyWith(
              fontSize: isMobile ? 19 : 22,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStepper(CartItem item) {
    Widget step(IconData icon, String label, VoidCallback onPressed) =>
        SizedBox(
          width: 40,
          height: 36,
          child: IconButton(
            tooltip: label,
            padding: EdgeInsets.zero,
            onPressed: onPressed,
            icon: Icon(icon, size: 18, color: KioskTheme.pinkInk),
          ),
        );
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
        border: Border.all(color: KioskTheme.rule, width: 1.5),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          step(
            Icons.remove_rounded,
            'One less ${item.name}',
            () => cartNotifier.decrement(item.id),
          ),
          SizedBox(
            width: 26,
            child: Text(
              '${item.quantity}',
              textAlign: TextAlign.center,
              style: KioskTheme.hand(fontSize: 22),
            ),
          ),
          step(
            Icons.add_rounded,
            'One more ${item.name}',
            () => cartNotifier.increment(item.id),
          ),
        ],
      ),
    );
  }
}
