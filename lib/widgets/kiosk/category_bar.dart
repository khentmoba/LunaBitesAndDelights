import 'package:flutter/material.dart' hide MenuTheme;
import 'package:provider/provider.dart';
import 'menu_theme.dart';
import '../../services/session.dart';
import '../../data/menu_data.dart';

class KioskCategoryBar extends StatelessWidget {
  const KioskCategoryBar({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<KioskSession>(
      builder: (context, session, child) {
        return Container(
          width: double.infinity,
          decoration: const BoxDecoration(
            color: MenuTheme.paper,
            border: Border(bottom: BorderSide(color: MenuTheme.pink, width: 2)),
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                for (var i = 0; i < kMenuSections.length; i++) ...[
                  if (i > 0) const SizedBox(width: 8),
                  ChoiceChip(
                    label: Text(kMenuSections[i].title),
                    selected: session.currentCategoryId == kMenuSections[i].id,
                    onSelected: (_) => session.setCategory(kMenuSections[i].id),
                    selectedColor: MenuTheme.plate,
                    backgroundColor: MenuTheme.card,
                    checkmarkColor: MenuTheme.onPlate,
                    materialTapTargetSize: MaterialTapTargetSize.padded,
                    labelStyle: MenuTheme.body(
                      size: 14,
                      color: session.currentCategoryId == kMenuSections[i].id
                          ? MenuTheme.onPlate
                          : MenuTheme.ink,
                    ).copyWith(fontWeight: FontWeight.w700),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 8,
                    ),
                    shape: const RoundedRectangleBorder(
                      borderRadius: MenuTheme.radius,
                    ),
                    side: BorderSide(
                      color: session.currentCategoryId == kMenuSections[i].id
                          ? MenuTheme.plate
                          : MenuTheme.pinkInk,
                      width: 1.5,
                    ),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}
