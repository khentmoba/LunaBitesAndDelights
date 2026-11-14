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
              letterSpacing: isMobile ? 0.5 : 1.5,
            ),
          ),
          centerTitle: true,
          backgroundColor: KioskTheme.lunaPaper,
          elevation: 0,
          shape: const Border(
            bottom: BorderSide(color: KioskTheme.lunaLogoPink, width: 2),
          ),
          leading: IconButton(
            tooltip: 'Back',
            icon: Icon(
              Icons.adaptive.arrow_back,
              color: KioskTheme.pinkInk,
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
                  style: TextButton.styleFrom(
                    minimumSize: const Size(48, 44),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                  ),
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
                      fontSize: isMobile ? 12 : 13,
                      letterSpacing: 0.6,
                    ),
                  ),
                );
              },
            ),
            const SizedBox(width: 4),
          ],
        ),
        body: ListenableBuilder(
          listenable: cartNotifier,
          builder: (context, _) {
            if (cartNotifier.items.isEmpty) {
              return SafeArea(
                child: Center(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 32,
                      vertical: 24,
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.shopping_cart_outlined,
                          size: isMobile ? 60 : 96,
                          color: KioskTheme.lunaPink.withValues(alpha: 0.35),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'Your order slip is empty',
                          textAlign: TextAlign.center,
                          style: KioskTheme.headerMedium.copyWith(
                            fontSize: isMobile ? 20 : 24,
                          ),
                        ),
                        SizedBox(height: isMobile ? 20 : 28),
                        FilledButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('Browse the menu'),
                        ),
                      ],
                    ),
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
                  decoration: BoxDecoration(
                    color: KioskTheme.lunaPaper,
                    border: const Border(
                      top: BorderSide(color: KioskTheme.lunaLogoPink, width: 2),
                    ),
                    boxShadow: KioskTheme.shadowLg,
                  ),
                  child: SafeArea(
                    top: false,
                    child: Center(
                      heightFactor: 1,
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 760),
                        child: Padding(
                          padding: EdgeInsets.fromLTRB(
                            isMobile ? 16 : 32,
                            isMobile ? 14 : 24,
                            isMobile ? 16 : 32,
                            isMobile ? 14 : 24,
                          ),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    'TOTAL',
                                    style: KioskTheme.labelMedium.copyWith(
                                      fontSize: isMobile ? 13 : 16,
                                      color: KioskTheme.textSecondary,
                                    ),
                                  ),
                                  Text(
                                    '\u20B1${cartNotifier.totalPrice}',
                                    style: KioskTheme.displayMedium.copyWith(
                                      fontSize: isMobile ? 28 : 40,
                                      fontFeatures: const [
                                        FontFeature.tabularFigures(),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                              SizedBox(height: isMobile ? 12 : 20),
                              LayoutBuilder(
                                builder: (context, constraints) {
                                  final stackButtons =
                                      constraints.maxWidth < 310;
                                  final addMore = OutlinedButton(
                                    onPressed: () => Navigator.pop(context),
                                    style: OutlinedButton.styleFrom(
                                      foregroundColor: KioskTheme.pinkInk,
                                      minimumSize: const Size(48, 50),
                                      side: const BorderSide(
                                        color: KioskTheme.pinkInk,
                                        width: 2,
                                      ),
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(
                                          KioskTheme.radiusMd,
                                        ),
                                      ),
                                    ),
                                    child: Text(
                                      isMobile ? 'Add more' : 'Add more food',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: KioskTheme.font(
                                        fontWeight: FontWeight.w700,
                                        fontSize: 15,
                                        color: KioskTheme.pinkInk,
                                      ),
                                    ),
                                  );
                                  final checkout = JuicyFeedback(
                                    child: FilledButton(
                                      onPressed: () => Navigator.pushNamed(
                                        context,
                                        '/checkout_process',
                                      ),
                                      style: FilledButton.styleFrom(
                                        backgroundColor: KioskTheme.lunaPink,
                                        foregroundColor:
                                            KioskTheme.textOnPrimary,
                                        minimumSize: const Size(48, 50),
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(
                                            KioskTheme.radiusMd,
                                          ),
                                        ),
                                      ),
                                      child: Text(
                                        'Checkout',
                                        style: KioskTheme.font(
                                          fontSize: 16,
                                          fontWeight: FontWeight.w800,
                                          color: KioskTheme.textOnPrimary,
                                        ),
                                      ),
                                    ),
                                  );
                                  if (stackButtons) {
                                    return Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.stretch,
                                      children: [
                                        checkout,
                                        const SizedBox(height: 8),
                                        addMore,
                                      ],
                                    );
                                  }
                                  return Row(
                                    children: [
                                      Expanded(child: addMore),
                                      const SizedBox(width: 12),
                                      Expanded(flex: 2, child: checkout),
                                    ],
                                  );
                                },
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
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
              item.imageUrl.isNotEmpty ? item.imageUrl : 'images/luna_logo.png',
              width: imageSize,
              height: imageSize,
              fit: BoxFit.cover,
              excludeFromSemantics: true,
              errorBuilder: (_, _, _) => Image.asset(
                'images/luna_logo.png',
                width: imageSize,
                height: imageSize,
                fit: BoxFit.cover,
                excludeFromSemantics: true,
              ),
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
          width: 44,
          height: 44,
          child: IconButton(
            tooltip: label,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
            onPressed: onPressed,
            icon: Icon(icon, size: 20, color: KioskTheme.pinkInk),
          ),
        );
    return Container(
      decoration: BoxDecoration(
        color: KioskTheme.lunaBlushPaper,
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
          ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 28),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Text(
                '${item.quantity}',
                textAlign: TextAlign.center,
                style: KioskTheme.hand(fontSize: 22),
              ),
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
