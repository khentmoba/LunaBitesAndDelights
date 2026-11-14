import 'dart:async';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import '../services/cart_notifier.dart';
import '../services/session.dart';
import '../widgets/kiosk/kiosk_theme.dart';

class InactivityWatcher extends StatefulWidget {
  final Widget child;
  const InactivityWatcher({super.key, required this.child});

  @override
  State<InactivityWatcher> createState() => _InactivityWatcherState();
}

class _InactivityWatcherState extends State<InactivityWatcher> {
  Timer? _inactivityTimer;
  Timer? _countdownTimer;
  int _secondsRemaining = 15;
  bool _dialogOpen = false;

  @override
  void initState() {
    super.initState();
    session.addListener(_onSessionChanged);
    _resetInactivityTimer();
  }

  void _onSessionChanged() {
    if (!mounted) return;
    _resetInactivityTimer();
  }

  @override
  void dispose() {
    session.removeListener(_onSessionChanged);
    _inactivityTimer?.cancel();
    _countdownTimer?.cancel();
    super.dispose();
  }

  void _resetInactivityTimer() {
    if (_dialogOpen) return;
    _inactivityTimer?.cancel();
    // Keep the 2-minute unattended reset on web kiosk and staff POS sessions,
    // while letting personal native Android/iOS app users switch apps freely.
    if (!kIsWeb && !session.isStaff) return;
    _inactivityTimer = Timer(const Duration(minutes: 2), () {
      if (!mounted || (!kIsWeb && !session.isStaff)) return;
      final isCurrent = ModalRoute.of(context)?.isCurrent ?? true;
      if (!isCurrent) {
        _resetInactivityTimer();
        return;
      }
      _showWarningDialog();
    });
  }

  void _showWarningDialog() {
    if (!mounted) return;
    setState(() {
      _dialogOpen = true;
      _secondsRemaining = 15;
    });

    StateSetter? dialogSetState;
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_secondsRemaining > 1) {
        _secondsRemaining--;
        dialogSetState?.call(() {});
      } else {
        timer.cancel();
        _dialogOpen = false;
        if (Navigator.of(context).canPop()) {
          Navigator.of(context).pop();
        }
        _performReset();
      }
    });

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext dialogContext) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            dialogSetState = setDialogState;
            return AlertDialog(
              backgroundColor: KioskTheme.lunaPaper,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(KioskTheme.radiusLg),
                side: const BorderSide(color: KioskTheme.rule),
              ),
              title: Center(
                child: Text(
                  'ARE YOU STILL THERE?',
                  textAlign: TextAlign.center,
                  style: KioskTheme.font(
                    fontWeight: FontWeight.w800,
                    fontSize: 20,
                    color: KioskTheme.pinkInk,
                    letterSpacing: 1.5,
                  ),
                ),
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(height: 12),
                  Text(
                    'This kiosk will automatically reset to the main screen in:',
                    style: KioskTheme.font(
                      fontSize: 14,
                      color: KioskTheme.textSecondary,
                      fontWeight: FontWeight.w500,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 20),
                  Container(
                    width: 84,
                    height: 84,
                    decoration: const BoxDecoration(
                      color: KioskTheme.lunaBlushPaper,
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: Text(
                        '$_secondsRemaining',
                        style: KioskTheme.font(
                          fontSize: 34,
                          fontWeight: FontWeight.w800,
                          color: KioskTheme.pinkInk,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
              ),
              actions: [
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () {
                      _countdownTimer?.cancel();
                      Navigator.of(context).pop();
                      setState(() {
                        _dialogOpen = false;
                      });
                      _resetInactivityTimer();
                    },
                    child: const Text('YES, I AM HERE'),
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  void _performReset() {
    cartNotifier.clear();
    kioskSession.reset();
    Navigator.of(context).pushNamedAndRemoveUntil('/', (route) => false);
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerDown: (_) => _resetInactivityTimer(),
      onPointerMove: (_) => _resetInactivityTimer(),
      child: widget.child,
    );
  }
}
