import 'package:flutter/material.dart' hide MenuTheme;
import 'menu_theme.dart';
import '../../models/menu.dart';

class KioskProductCard extends StatelessWidget {
  final MenuItem item;
  final VoidCallback onTap;

  const KioskProductCard({super.key, required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final promo = item.promoLabel ?? (item.isBuy1Take1 ? 'BUY 1 TAKE 1' : null);
    Widget fallback(BuildContext context, Object error, StackTrace? trace) =>
        const ColoredBox(
          color: MenuTheme.blushPaper,
          child: Center(
            child: Icon(
              Icons.restaurant_outlined,
              color: MenuTheme.pinkInk,
              size: 40,
            ),
          ),
        );

    return Semantics(
      button: true,
      label:
          '${item.name}, ${item.hasVariants ? 'from ' : ''}₱${item.displayPrice}',
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: MenuTheme.radius,
          boxShadow: [
            BoxShadow(
              color: MenuTheme.pinkInk.withValues(alpha: .18),
              blurRadius: 18,
              spreadRadius: -6,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: Material(
          color: MenuTheme.card,
          shape: const RoundedRectangleBorder(
            borderRadius: MenuTheme.radius,
            side: BorderSide(color: MenuTheme.rule),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  child: Hero(
                    tag: 'product_${item.id}',
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(6, 6, 6, 0),
                          child: item.imageUrl.startsWith('http')
                              ? Image.network(
                                  item.imageUrl,
                                  fit: BoxFit.cover,
                                  errorBuilder: fallback,
                                )
                              : Image.asset(
                                  item.imageUrl.isNotEmpty
                                      ? item.imageUrl
                                      : 'images/luna_logo.webp',
                                  fit: BoxFit.cover,
                                  errorBuilder: fallback,
                                ),
                        ),
                        if (promo != null)
                          Positioned(
                            top: 14,
                            left: 0,
                            right: 12,
                            child: Align(
                              alignment: Alignment.centerLeft,
                              child: Transform.rotate(
                                angle: -.035,
                                child: Container(
                                  color: MenuTheme.butter,
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 5,
                                  ),
                                  child: Text(
                                    promo,
                                    style: MenuTheme.body(
                                      size: 12,
                                    ).copyWith(fontWeight: FontWeight.w800),
                                  ),
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      ConstrainedBox(
                        constraints: BoxConstraints(
                          minHeight:
                              MediaQuery.textScalerOf(context).scale(16) * 2.4,
                        ),
                        child: Text(
                          item.name,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: MenuTheme.body().copyWith(
                            fontWeight: FontWeight.w600,
                            height: 1.2,
                          ),
                        ),
                      ),
                      const Divider(height: 12, thickness: 1),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          Expanded(
                            child: Text.rich(
                              TextSpan(
                                children: [
                                  if (item.hasVariants)
                                    TextSpan(
                                      text: 'From ',
                                      style: MenuTheme.body(
                                        size: 13,
                                        color: MenuTheme.inkSoft,
                                      ),
                                    ),
                                  TextSpan(
                                    text: '₱${item.displayPrice}',
                                    style: MenuTheme.price(size: 20),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          Container(
                            width: 36,
                            height: 36,
                            decoration: const BoxDecoration(
                              color: MenuTheme.plate,
                              borderRadius: MenuTheme.radius,
                            ),
                            child: const Icon(
                              Icons.add,
                              color: MenuTheme.onPlate,
                              size: 22,
                              semanticLabel: 'Choose item',
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
