import 'package:flutter/material.dart' hide MenuTheme;
import '../widgets/kiosk/menu_theme.dart';
import 'staff_bundle.dart' deferred as staff;

enum StaffScreen { dashboard, kds, analytics, lifetimeAnalytics }

/// A staff screen whose code downloads the first time it opens. On web the
/// dashboard, kitchen display and analytics ship as a separate JS part, so
/// customers ordering from the kiosk never pay for them.
class DeferredStaffScreen extends StatefulWidget {
  const DeferredStaffScreen(this.screen, {super.key});

  final StaffScreen screen;

  @override
  State<DeferredStaffScreen> createState() => _DeferredStaffScreenState();
}

class _DeferredStaffScreenState extends State<DeferredStaffScreen> {
  static Future<void>? _loading;
  late Future<void> _load = _start();

  static Future<void> _start() =>
      _loading ??= staff.loadLibrary().catchError((Object e) {
        _loading = null; // let RETRY start a fresh download
        throw e;
      });

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<void>(
      future: _load,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.done && !snap.hasError) {
          return staff.buildStaffScreen(widget.screen);
        }
        return Scaffold(
          backgroundColor: MenuTheme.ground,
          body: Center(
            child: snap.hasError
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Could not load staff tools. Check the connection.',
                        textAlign: TextAlign.center,
                        style: MenuTheme.body(size: 15),
                      ),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: () => setState(() => _load = _start()),
                        child: const Text('RETRY'),
                      ),
                    ],
                  )
                : Semantics(
                    label: 'Loading staff tools',
                    child: const CircularProgressIndicator.adaptive(
                      valueColor: AlwaysStoppedAnimation<Color>(
                        MenuTheme.pinkInk,
                      ),
                    ),
                  ),
          ),
        );
      },
    );
  }
}
