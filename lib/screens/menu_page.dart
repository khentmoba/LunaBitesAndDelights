import 'package:flutter/material.dart' hide MenuTheme;
import 'package:provider/provider.dart';
import '../data/menu_data.dart';
import '../models/menu.dart';
import '../services/session.dart';
import '../services/cart_notifier.dart';
import '../services/inactivity_timer.dart';
import '../widgets/kiosk/menu_theme.dart';
import '../widgets/kiosk/sidebar.dart';
import '../widgets/kiosk/category_bar.dart';
import '../widgets/kiosk/product_card.dart';
import '../widgets/kiosk/customization_modal.dart';
import 'staff_menu.dart';

class KioskMenuPage extends StatelessWidget {
  const KioskMenuPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: MenuTheme.data,
      child: Builder(
        builder: (context) {
          final wide = MediaQuery.sizeOf(context).width >= 1000;
          return InactivityWatcher(
            child: Scaffold(
              backgroundColor: MenuTheme.ground,
              body: SafeArea(
                child: Row(
                  children: [
                    if (wide) const KioskSidebar(),
                    Expanded(
                      child: Column(
                        children: [
                          DecoratedBox(
                            decoration: BoxDecoration(
                              color: MenuTheme.paper,
                              border: wide
                                  ? const Border(
                                      bottom: BorderSide(
                                        color: MenuTheme.pink,
                                        width: 2,
                                      ),
                                    )
                                  : null,
                            ),
                            child: _buildHeader(context, wide),
                          ),
                          if (!wide) const KioskCategoryBar(),
                          Expanded(child: _buildProductGrid(context)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              bottomNavigationBar: _buildOrderBar(context),
            ),
          );
        },
      ),
    );
  }

  Widget _buildHeader(BuildContext context, bool wide) {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: wide ? 28 : 16, vertical: 12),
      child: Row(
        children: [
          Image.asset(
            'images/luna_logo.png',
            height: wide ? 56 : 48,
            excludeFromSemantics: true,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'Luna Bites & Delights',
              style: MenuTheme.heading(wide ? 26 : 20),
              maxLines: 2,
            ),
          ),
          ListenableBuilder(
            listenable: session,
            builder: (context, _) {
              if (!session.isStaff) return const SizedBox.shrink();
              return Padding(
                padding: const EdgeInsets.only(right: 6),
                child: GestureDetector(
                  onTap: () => Navigator.pushNamed(context, '/kds'),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 5,
                    ),
                    decoration: const BoxDecoration(
                      color: MenuTheme.plate,
                      borderRadius: MenuTheme.radius,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.outdoor_grill_rounded,
                          color: MenuTheme.onPlate,
                          size: 14,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          'ORDERS',
                          style: MenuTheme.body(
                            size: 11,
                            color: MenuTheme.onPlate,
                          ).copyWith(fontWeight: FontWeight.w800),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
          ListenableBuilder(
            listenable: cartNotifier,
            builder: (context, _) => IconButton(
              tooltip: 'View order, ${cartNotifier.totalCount} items',
              onPressed: () => Navigator.pushNamed(context, '/cart'),
              icon: Badge(
                isLabelVisible: cartNotifier.totalCount > 0,
                label: Text('${cartNotifier.totalCount}'),
                backgroundColor: MenuTheme.plate,
                textColor: MenuTheme.onPlate,
                child: const Icon(Icons.shopping_bag_outlined),
              ),
            ),
          ),
          _buildUtilities(context),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(MenuSection section, double gutter) {
    return Padding(
      padding: EdgeInsets.fromLTRB(gutter, 22, gutter, 8),
      child: Container(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
        decoration: const BoxDecoration(
          color: MenuTheme.paper,
          borderRadius: MenuTheme.radius,
          border: Border(bottom: BorderSide(color: MenuTheme.pink, width: 3)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              header: true,
              child: Text(section.title, style: MenuTheme.heading(34)),
            ),
            if (section.subtitle.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                section.subtitle,
                style: MenuTheme.body(size: 14, color: MenuTheme.inkSoft),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildUtilities(BuildContext context) {
    final appTheme = Theme.of(Navigator.of(context).context);
    return ListenableBuilder(
      listenable: session,
      builder: (context, _) => PopupMenuButton<String>(
        tooltip: 'Menu options',
        icon: const Icon(Icons.more_horiz),
        onSelected: (value) {
          if (value == 'staff') {
            showModalBottomSheet(
              context: context,
              backgroundColor: Colors.transparent,
              builder: (_) =>
                  Theme(data: appTheme, child: const StaffMenuDialog()),
            );
          } else if (value == 'reset') {
            kioskSession.reset();
            cartNotifier.clear();
            Navigator.of(
              context,
            ).pushNamedAndRemoveUntil('/', (route) => false);
          }
        },
        itemBuilder: (context) => [
          if (session.isStaff)
            const PopupMenuItem(value: 'staff', child: Text('Staff console')),
          const PopupMenuItem(value: 'reset', child: Text('Start over')),
        ],
      ),
    );
  }

  Widget _buildProductGrid(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = (constraints.maxWidth / 260).floor().clamp(2, 4);
        final gutter = constraints.maxWidth < 600 ? 16.0 : 28.0;
        const gap = 16.0;
        final cardWidth =
            (constraints.maxWidth - gutter * 2 - gap * (columns - 1)) / columns;
        final textScale = MediaQuery.textScalerOf(context).scale(16) / 16;
        final cardHeight = cardWidth * .8 + 144 * textScale;
        return Consumer<KioskSession>(
          builder: (context, session, child) {
            final section = kMenuSections.firstWhere(
              (s) => s.id == session.currentCategoryId,
            );
            return CustomScrollView(
              key: ValueKey(session.currentCategoryId),
              slivers: [
                SliverToBoxAdapter(child: _buildSectionHeader(section, gutter)),
                ..._buildDynamicSlivers(
                  section.items,
                  context,
                  columns,
                  cardHeight,
                  gutter,
                ),
              ],
            );
          },
        );
      },
    );
  }

  List<Widget> _buildDynamicSlivers(
    List<MenuItem> items,
    BuildContext context,
    int columns,
    double cardHeight,
    double gutter,
  ) {
    final slivers = <Widget>[];
    var currentGroup = <MenuItem>[];

    void addGrid() {
      if (currentGroup.isEmpty) return;
      final group = List<MenuItem>.from(currentGroup);
      slivers.add(
        SliverPadding(
          padding: EdgeInsets.fromLTRB(gutter, 12, gutter, 20),
          sliver: SliverGrid(
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: columns,
              mainAxisExtent: cardHeight,
              crossAxisSpacing: 16,
              mainAxisSpacing: 16,
            ),
            delegate: SliverChildBuilderDelegate((context, index) {
              final item = group[index];
              return KioskProductCard(
                item: item,
                onTap: () => showModalBottomSheet(
                  context: context,
                  isScrollControlled: true,
                  useSafeArea: true,
                  constraints: const BoxConstraints(maxWidth: 960),
                  builder: (_) => KioskProductSheet(item: item),
                ),
              );
            }, childCount: group.length),
          ),
        ),
      );
      currentGroup = [];
    }

    for (final item in items) {
      if (item.isHeader) {
        addGrid();
        slivers.add(
          SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.fromLTRB(gutter, 24, gutter, 4),
              child: Semantics(
                header: true,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
                  color: MenuTheme.plate,
                  child: Text(
                    item.name.toUpperCase(),
                    style: MenuTheme.label(
                      size: 15,
                      color: MenuTheme.onPlate,
                    ).copyWith(letterSpacing: 1.2),
                  ),
                ),
              ),
            ),
          ),
        );
      } else {
        currentGroup.add(item);
      }
    }
    addGrid();
    return slivers;
  }

  Widget _buildOrderBar(BuildContext context) {
    return ListenableBuilder(
      listenable: cartNotifier,
      builder: (context, _) {
        if (cartNotifier.totalCount == 0) return const SizedBox.shrink();
        return SafeArea(
          top: false,
          child: Container(
            decoration: const BoxDecoration(
              color: MenuTheme.paper,
              border: Border(top: BorderSide(color: MenuTheme.pink, width: 2)),
            ),
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
            child: Center(
              heightFactor: 1,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 700),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () => Navigator.pushNamed(context, '/cart'),
                    icon: const Icon(Icons.shopping_bag_outlined),
                    label: Text(
                      'View order (${cartNotifier.totalCount}) · ₱${cartNotifier.totalPrice}',
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
