import 'dart:async';
import 'package:flutter/material.dart';
import '../services/cart_notifier.dart';
import '../services/session.dart';
import '../widgets/kiosk/kiosk_theme.dart';
import '../widgets/kiosk/juicy_feedback.dart';

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
    _resetInactivityTimer();
  }

  @override
  void dispose() {
    _inactivityTimer?.cancel();
    _countdownTimer?.cancel();
    super.dispose();
  }

  void _resetInactivityTimer() {
    if (_dialogOpen) return;
    _inactivityTimer?.cancel();
    _inactivityTimer = Timer(const Duration(minutes: 2), () {
      if (!mounted) return;
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
              backgroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(32),
              ),
              title: Center(
                child: Text(
                  'ARE YOU STILL THERE?',
                  style: KioskTheme.font(
                    fontWeight: FontWeight.w800,
                    fontSize: 20,
                    color: KioskTheme.lunaPink,
                    letterSpacing: 1.5,
                  ),
                ),
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(height: 16),
                  Text(
                    'This kiosk will automatically reset to the main screen in:',
                    style: KioskTheme.font(
                      fontSize: 14,
                      color: Colors.grey[600],
                      fontWeight: FontWeight.w500,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 24),
                  Container(
                    width: 90,
                    height: 90,
                    decoration: BoxDecoration(
                      color: KioskTheme.lunaPink.withValues(alpha: 0.05),
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: Text(
                        '$_secondsRemaining',
                        style: KioskTheme.font(
                          fontSize: 36,
                          fontWeight: FontWeight.w800,
                          color: KioskTheme.lunaPink,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
              ),
              actions: [
                Center(
                  child: JuicyFeedback(
                    onPressed: () {
                      _countdownTimer?.cancel();
                      Navigator.of(context).pop();
                      setState(() {
                        _dialogOpen = false;
                      });
                      _resetInactivityTimer();
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 40,
                        vertical: 16,
                      ),
                      decoration: BoxDecoration(
                        color: KioskTheme.lunaPink,
                        borderRadius: BorderRadius.circular(
                          KioskTheme.radiusMd,
                        ),
                      ),
                      child: Text(
                        'YES, I AM HERE',
                        style: KioskTheme.font(
                          color: KioskTheme.textOnPrimary,
                          fontWeight: FontWeight.w800,
                          fontSize: 14,
                          letterSpacing: 1,
                        ),
                      ),
                    ),
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
