import 'dart:math' as math;
import 'package:flutter/material.dart' hide MenuTheme;
import 'menu_theme.dart';
import '../../models/menu.dart';
import '../../models/cart.dart';
import '../../services/cart_notifier.dart';

class KioskProductSheet extends StatefulWidget {
  final MenuItem item;
  const KioskProductSheet({super.key, required this.item});

  @override
  State<KioskProductSheet> createState() => _KioskProductSheetState();
}

class _KioskProductSheetState extends State<KioskProductSheet> {
  int _qty = 1;
  int _selectedVariantIdx = -1;
  final Set<int> _selectedIndices = {};

  int get _price {
    if (widget.item.allowMultiSelect) {
      int total = widget.item.price ?? 0;
      for (var idx in _selectedIndices) {
        total += widget.item.variants[idx].price;
      }
      return total;
    }
    return widget.item.hasVariants
        ? (_selectedVariantIdx < 0
              ? widget.item.displayPrice
              : widget.item.variants[_selectedVariantIdx].price)
        : (widget.item.price ?? 0);
  }

  String get _variantLabel {
    if (widget.item.allowMultiSelect) {
      if (_selectedIndices.isEmpty) return '';
      return _selectedIndices
          .map((idx) => widget.item.variants[idx].label)
          .join(', ');
    }
    return (!widget.item.hasVariants || _selectedVariantIdx < 0)
        ? ''
        : widget.item.variants[_selectedVariantIdx].label;
  }

  bool get _canAdd => widget.item.allowMultiSelect
      ? _selectedIndices.isNotEmpty
      : (!widget.item.hasVariants || _selectedVariantIdx >= 0);

  void _addToCart() {
    if (!_canAdd) return;
    cartNotifier.add(
      CartItem(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        name: widget.item.name,
        emoji: widget.item.emoji,
        imageUrl: widget.item.imageUrl,
        variant: _variantLabel,
        price: _price,
        quantity: _qty,
      ),
    );
    Navigator.pop(context);
  }

  void _selectVariant(int index) {
    setState(() {
      if (!widget.item.allowMultiSelect) {
        _selectedVariantIdx = index;
      } else if (_selectedIndices.contains(index)) {
        _selectedIndices.remove(index);
      } else if (_selectedIndices.length < widget.item.maxSelect) {
        _selectedIndices.add(index);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Choose up to ${widget.item.maxSelect} flavours.'),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final isCompact = size.width < 700;
    final maxHeight = !widget.item.hasVariants && !isCompact
        ? math.min(460.0, size.height * .9)
        : size.height * .9;
    return Theme(
      data: MenuTheme.data,
      child: Material(
        color: MenuTheme.paper,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(10)),
        clipBehavior: Clip.antiAlias,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: maxHeight),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (isCompact)
                  Padding(
                    padding: const EdgeInsets.only(top: 10, bottom: 2),
                    child: Center(
                      child: Container(
                        width: 36,
                        height: 4,
                        decoration: BoxDecoration(
                          color: MenuTheme.rule,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 4, 8, 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text('Item details', style: MenuTheme.label()),
                      ),
                      IconButton(
                        tooltip: 'Close item details',
                        onPressed: () => Navigator.pop(context),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 2, thickness: 2, color: MenuTheme.pink),
                Flexible(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(20),
                    child: LayoutBuilder(
                      builder: (context, constraints) {
                        final image = _buildImage(constraints.maxWidth >= 600);
                        final details = _buildDetails();
                        if (constraints.maxWidth >= 600) {
                          return Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              SizedBox(width: 240, child: image),
                              const SizedBox(width: 28),
                              Expanded(child: details),
                            ],
                          );
                        }
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            image,
                            const SizedBox(height: 20),
                            details,
                          ],
                        );
                      },
                    ),
                  ),
                ),
                _buildFooter(context),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildImage(bool wide) {
    Widget fallback(BuildContext context, Object error, StackTrace? trace) =>
        const ColoredBox(
          color: MenuTheme.blushPaper,
          child: Center(
            child: Icon(
              Icons.restaurant_outlined,
              size: 64,
              color: MenuTheme.pinkInk,
            ),
          ),
        );
    return Hero(
      tag: 'product_${widget.item.id}',
      child: Container(
        height: wide ? 260 : 170,
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(
          color: MenuTheme.card,
          boxShadow: [
            BoxShadow(
              color: MenuTheme.pinkInk.withValues(alpha: .22),
              blurRadius: 22,
              spreadRadius: -8,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: widget.item.imageUrl.startsWith('http')
            ? Image.network(
                widget.item.imageUrl,
                fit: BoxFit.cover,
                errorBuilder: fallback,
              )
            : Image.asset(
                widget.item.imageUrl.isNotEmpty
                    ? widget.item.imageUrl
                    : 'images/luna_logo.png',
                fit: BoxFit.cover,
                errorBuilder: fallback,
              ),
      ),
    );
  }

  Widget _buildDetails() {
    final promo =
        widget.item.promoLabel ??
        (widget.item.isBuy1Take1 ? 'BUY 1 TAKE 1' : null);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          header: true,
          child: Text(widget.item.name, style: MenuTheme.heading(32)),
        ),
        if (promo != null) ...[
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: Container(
              color: MenuTheme.butter,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              child: Text(
                promo,
                style: MenuTheme.body(
                  size: 13,
                ).copyWith(fontWeight: FontWeight.w800),
              ),
            ),
          ),
        ],
        if (widget.item.description.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text(
            widget.item.description,
            style: MenuTheme.body(size: 15, color: MenuTheme.inkSoft),
          ),
        ],
        if (widget.item.hasVariants) ...[
          const SizedBox(height: 24),
          Text(
            widget.item.optionHeader.toUpperCase(),
            style: MenuTheme.label(),
          ),
          if (widget.item.allowMultiSelect) ...[
            const SizedBox(height: 6),
            Text(
              'Choose up to ${widget.item.maxSelect} · ${_selectedIndices.length} selected',
              style: MenuTheme.body(size: 14, color: MenuTheme.inkSoft),
            ),
          ],
          const SizedBox(height: 12),
          if (widget.item.allowMultiSelect)
            for (final entry in widget.item.variants.asMap().entries)
              _buildOption(entry.key)
          else
            RadioGroup<int>(
              groupValue: _selectedVariantIdx,
              onChanged: (value) {
                if (value != null) _selectVariant(value);
              },
              child: Column(
                children: [
                  for (var i = 0; i < widget.item.variants.length; i++)
                    _buildOption(i),
                ],
              ),
            ),
        ],
      ],
    );
  }

  Widget _buildOption(int index) {
    final variant = widget.item.variants[index];
    final selected = widget.item.allowMultiSelect
        ? _selectedIndices.contains(index)
        : _selectedVariantIdx == index;
    final label = Row(
      children: [
        Expanded(child: Text(variant.label, style: MenuTheme.body(size: 15))),
        if (variant.price > 0) ...[
          const SizedBox(width: 8),
          Text('₱${variant.price}', style: MenuTheme.price(size: 17)),
        ],
      ],
    );
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: selected ? MenuTheme.blushPaper : MenuTheme.card,
        borderRadius: MenuTheme.radius,
        border: Border.all(
          color: selected ? MenuTheme.plate : MenuTheme.rule,
          width: selected ? 2 : 1,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: widget.item.allowMultiSelect
            ? CheckboxListTile.adaptive(
                value: selected,
                onChanged: (_) => _selectVariant(index),
                activeColor: MenuTheme.plate,
                checkColor: MenuTheme.onPlate,
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 4,
                ),
                title: label,
              )
            : RadioListTile<int>.adaptive(
                value: index,
                activeColor: MenuTheme.plate,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 4,
                ),
                title: label,
              ),
      ),
    );
  }

  Widget _buildFooter(BuildContext context) {
    final quantity = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          tooltip: 'Decrease quantity',
          onPressed: _qty > 1 ? () => setState(() => _qty--) : null,
          icon: const Icon(Icons.remove),
        ),
        SizedBox(
          width: 36,
          child: Semantics(
            liveRegion: true,
            label: 'Quantity $_qty',
            child: Text(
              '$_qty',
              textAlign: TextAlign.center,
              style: MenuTheme.body().copyWith(fontWeight: FontWeight.w700),
            ),
          ),
        ),
        IconButton(
          tooltip: 'Increase quantity',
          onPressed: () => setState(() => _qty++),
          icon: const Icon(Icons.add),
        ),
      ],
    );
    final addButton = FilledButton(
      onPressed: _canAdd ? _addToCart : null,
      child: Text(
        'Add to order · ₱${_price * _qty}',
        textAlign: TextAlign.center,
      ),
    );
    return Container(
      decoration: const BoxDecoration(
        color: MenuTheme.card,
        border: Border(top: BorderSide(color: MenuTheme.rule)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (!_canAdd) ...[
            Text(
              'Choose an option to continue.',
              style: MenuTheme.hand(size: 21, color: MenuTheme.pinkInk),
            ),
            const SizedBox(height: 8),
          ],
          LayoutBuilder(
            builder: (context, constraints) {
              if (constraints.maxWidth < 400) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Align(alignment: Alignment.centerLeft, child: quantity),
                    const SizedBox(height: 8),
                    addButton,
                  ],
                );
              }
              return Row(
                children: [
                  quantity,
                  const SizedBox(width: 20),
                  Expanded(child: addButton),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}
