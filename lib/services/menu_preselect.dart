import 'package:flutter/material.dart';

import '../data/menu_data.dart';
import '../models/cart.dart';
import '../models/menu.dart';
import '../widgets/kiosk/customization_modal.dart';
import 'cart_notifier.dart';
import 'session.dart';
import 'url_helper.dart';

/// What the storefront's "Order these now" link asked the kiosk to start with.
///
/// The landing page sends one `pick` query value per marked row, in the same
/// `id` / `id#Variant label` form that `site_price_parity_test.dart` uses, or
/// `@section` for a row that stands for a whole section.
class MenuPreselection {
  /// Items whose price is settled; they go straight into the cart.
  final List<CartItem> ready;

  /// Items that still need a flavour or size; their sheet opens in turn.
  final List<MenuItem> needsChoice;

  /// The section the menu should open on.
  final String? sectionId;

  const MenuPreselection({
    this.ready = const [],
    this.needsChoice = const [],
    this.sectionId,
  });

  bool get isEmpty => ready.isEmpty && needsChoice.isEmpty && sectionId == null;
}

MenuPreselection resolvePicks(Iterable<String> picks) {
  final ready = <CartItem>[];
  final needsChoice = <MenuItem>[];
  String? sectionId;
  var n = 0;

  for (final pick in picks.take(80)) {
    if (pick.startsWith('@')) {
      final id = pick.substring(1);
      if (kMenuSections.any((s) => s.id == id)) sectionId ??= id;
      continue;
    }
    final hash = pick.indexOf('#');
    final id = hash < 0 ? pick : pick.substring(0, hash);
    final label = hash < 0 ? null : pick.substring(hash + 1);

    MenuItem? item;
    String? itemSection;
    for (final section in kMenuSections) {
      for (final candidate in section.items) {
        if (candidate.id == id && !candidate.isHeader) {
          item = candidate;
          itemSection = section.id;
        }
      }
    }
    if (item == null) continue;
    sectionId ??= itemSection;

    MenuVariant? variant;
    if (label != null && !item.allowMultiSelect) {
      for (final v in item.variants) {
        if (v.label == label) variant = v;
      }
    }

    if (variant == null && item.hasVariants) {
      if (!needsChoice.any((m) => m.id == item!.id)) needsChoice.add(item);
      continue;
    }
    ready.add(
      CartItem(
        id: '${DateTime.now().microsecondsSinceEpoch}-${n++}',
        name: item.name,
        emoji: item.emoji,
        imageUrl: item.imageUrl,
        variant: variant?.label ?? '',
        price: variant?.price ?? item.price ?? 0,
      ),
    );
  }
  return MenuPreselection(
    ready: ready,
    needsChoice: needsChoice,
    sectionId: sectionId,
  );
}

bool _taken = false;

/// Reads the storefront's picks from the page URL once per app load, then
/// drops them from the address bar so a reload does not add them again.
List<String> takeStorefrontPicks([Uri? from]) {
  if (_taken) return const [];
  _taken = true;
  final uri = from ?? Uri.base;
  final picks = uri.queryParametersAll['pick'] ?? const <String>[];
  if (picks.isNotEmpty && from == null) {
    replaceBrowserUrl(
      '${uri.path}${uri.hasFragment ? '#${uri.fragment}' : ''}',
    );
  }
  return picks;
}

@visibleForTesting
void resetStorefrontPicks() => _taken = false;

/// Applies the storefront's picks when the menu first shows: settled items go
/// into the cart, items that need a choice open their sheet, and the visitor
/// stays on the menu to keep adding.
class MenuPreselectHost extends StatefulWidget {
  final Widget child;
  final List<String> Function() readPicks;

  const MenuPreselectHost({
    super.key,
    required this.child,
    this.readPicks = takeStorefrontPicks,
  });

  @override
  State<MenuPreselectHost> createState() => _MenuPreselectHostState();
}

class _MenuPreselectHostState extends State<MenuPreselectHost> {
  @override
  void initState() {
    super.initState();
    final picks = widget.readPicks();
    if (picks.isEmpty) return;
    final result = resolvePicks(picks);
    if (result.isEmpty) return;
    WidgetsBinding.instance.addPostFrameCallback((_) => _apply(result));
  }

  Future<void> _apply(MenuPreselection result) async {
    final before = cartNotifier.totalCount;
    for (final item in result.ready) {
      cartNotifier.add(item);
    }
    if (result.sectionId != null) kioskSession.setCategory(result.sectionId!);

    for (final item in result.needsChoice) {
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        constraints: const BoxConstraints(maxWidth: 960),
        builder: (_) => KioskProductSheet(item: item),
      );
    }

    if (!mounted) return;
    final added = cartNotifier.totalCount - before;
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(
        content: Text(
          added > 0
              ? 'Added $added from the menu board. Keep adding, or tap View order.'
              : 'Pick what you want from the menu.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
