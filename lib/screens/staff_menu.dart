import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import '../services/functions.dart';
import '../services/session.dart';
import '../services/cart_notifier.dart';
import '../widgets/kiosk/kiosk_theme.dart';
import '../widgets/kiosk/juicy_feedback.dart';
import 'admin_dashboard.dart';
import 'menu_page.dart';

class StaffMenuDialog extends StatefulWidget {
  const StaffMenuDialog({super.key});

  @override
  State<StaffMenuDialog> createState() => _StaffMenuDialogState();
}

class _StaffMenuDialogState extends State<StaffMenuDialog> {
  bool _isGenerating = false;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(KioskTheme.radiusXl),
        ),
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: KioskTheme.rule,
                  borderRadius: BorderRadius.circular(KioskTheme.radiusSm),
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'STAFF CONTROL CONSOLE',
                style: KioskTheme.headerSmall.copyWith(letterSpacing: 2),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: _buildConsoleButton(
                      context,
                      icon: Icons.outdoor_grill_rounded,
                      title: 'LIVE ORDERS',
                      color: Colors.orange,
                      onTap: () {
                        Navigator.pop(context);
                        Navigator.pushNamed(context, '/kds');
                      },
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: _buildConsoleButton(
                      context,
                      icon: Icons.dashboard_rounded,
                      title: 'DASHBOARD',
                      color: Colors.purple,
                      onTap: () {
                        Navigator.pop(context);
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => const AdminDashboard(),
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              _buildActionItem(
                context,
                icon: Icons.point_of_sale_rounded,
                title: 'WALK-IN ORDER',
                subtitle: 'Take a walk-in order',
                color: KioskTheme.success,
                onTap: () {
                  Navigator.pop(context);
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const KioskMenuPage()),
                  );
                },
              ),
              const SizedBox(height: 12),
              _buildActionItem(
                context,
                icon: _isGenerating
                    ? Icons.hourglass_empty_rounded
                    : Icons.telegram_rounded,
                title: _isGenerating
                    ? 'GENERATING SUMMARY...'
                    : 'TELEGRAM DAILY SUMMARY',
                subtitle: _isGenerating
                    ? 'Sending report...'
                    : 'Send today\'s sales metrics to Telegram',
                color: _isGenerating ? KioskTheme.textMuted : KioskTheme.info,
                onTap: _isGenerating
                    ? () {}
                    : () {
                        _triggerManualReport();
                      },
              ),
              const SizedBox(height: 12),
              _buildActionItem(
                context,
                icon: Icons.logout_rounded,
                title: 'LOGOUT STAFF PORTAL',
                subtitle: 'Exit staff mode and clear active POS state',
                color: KioskTheme.error,
                onTap: () {
                  Navigator.pop(context);
                  Navigator.pop(context);
                  session.logout();
                  cartNotifier.clear();
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(
                        'STAFF LOGGED OUT',
                        style: KioskTheme.font(fontWeight: FontWeight.w800),
                      ),
                      backgroundColor: KioskTheme.lunaPink,
                    ),
                  );
                },
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildConsoleButton(
    BuildContext context, {
    required IconData icon,
    required String title,
    required Color color,
    required VoidCallback onTap,
  }) {
    return JuicyFeedback(
      onPressed: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 20),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
          border: Border.all(color: color.withValues(alpha: 0.15)),
        ),
        child: Column(
          children: [
            Icon(icon, color: color, size: 32),
            const SizedBox(height: 10),
            Text(
              title,
              style: KioskTheme.labelLarge.copyWith(color: color, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActionItem(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required Color color,
    required VoidCallback onTap,
  }) {
    return JuicyFeedback(
      onPressed: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
          border: Border.all(color: color.withValues(alpha: 0.1)),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: color, size: 22),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: KioskTheme.labelLarge.copyWith(
                      color: color,
                      fontSize: 13,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: KioskTheme.bodySmall.copyWith(fontSize: 11),
                  ),
                ],
              ),
            ),
            Icon(
              Icons.arrow_forward_ios_rounded,
              size: 14,
              color: color.withValues(alpha: 0.5),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _triggerManualReport() async {
    setState(() => _isGenerating = true);
    try {
      final data = await callFn('triggerManualReport', {}, 30);
      final bool isSuccess = data['success'] == true;
      final String msg = data['message'] ?? 'No message';

      if (mounted) {
        if (isSuccess) {
          Navigator.pop(context);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'SALES REPORT SENT TO TELEGRAM!',
                style: KioskTheme.font(fontWeight: FontWeight.w800),
              ),
              backgroundColor: KioskTheme.success,
            ),
          );
        } else {
          setState(() => _isGenerating = false);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'ERROR: $msg',
                style: KioskTheme.font(fontWeight: FontWeight.w800),
              ),
              backgroundColor: KioskTheme.warning,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isGenerating = false);
        String errorMessage;
        if (e is FirebaseFunctionsException) {
          errorMessage = e.message ?? e.code;
        } else {
          errorMessage = e.toString().split('\n').first;
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'CRASH: $errorMessage',
              style: KioskTheme.font(fontWeight: FontWeight.w800),
            ),
            backgroundColor: KioskTheme.error,
          ),
        );
      }
    }
  }
}
