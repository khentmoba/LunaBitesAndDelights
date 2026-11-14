import 'package:flutter/material.dart';
import '../kiosk/kiosk_theme.dart';

/// Shared scaffold for the brown-header report pages (sales dashboard,
/// lifetime report, KDS): loading spinner + error/retry states included.
class ReportScaffold extends StatelessWidget {
  final String title;
  final bool loading;
  final String? error;
  final VoidCallback onRetry;
  final VoidCallback? onRefresh;
  final String refreshTooltip;
  final Widget body;

  const ReportScaffold({
    super.key,
    required this.title,
    required this.loading,
    required this.error,
    required this.onRetry,
    required this.onRefresh,
    this.refreshTooltip = 'Refresh',
    required this.body,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: KioskTheme.lunaBlushPaper,
      appBar: AppBar(
        title: FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            title,
            maxLines: 1,
            style: KioskTheme.headerSmall.copyWith(
              color: KioskTheme.textOnPrimary,
              letterSpacing: 2,
            ),
          ),
        ),
        centerTitle: true,
        backgroundColor: KioskTheme.lunaPink,
        foregroundColor: KioskTheme.textOnPrimary,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: refreshTooltip,
            onPressed: onRefresh,
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        top: false,
        child: loading
            ? const Center(
                child: CircularProgressIndicator.adaptive(
                  valueColor: AlwaysStoppedAnimation<Color>(
                    KioskTheme.lunaPink,
                  ),
                ),
              )
            : error != null
            ? ReportError(message: error!, onRetry: onRetry)
            : body,
      ),
    );
  }
}

/// Centered error icon + message + retry button.
class ReportError extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const ReportError({super.key, required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(
            Icons.error_outline_rounded,
            color: KioskTheme.error,
            size: 48,
          ),
          const SizedBox(height: 16),
          Text(message, style: KioskTheme.bodyLarge.copyWith(fontSize: 16)),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: onRetry,
            style: KioskTheme.primaryButton,
            child: Text('Retry', style: KioskTheme.font(color: Colors.white)),
          ),
        ],
      ),
    );
  }
}

/// White rounded card used across reports and the admin dashboard.
class WhiteCard extends StatelessWidget {
  final Widget child;
  final double pad;
  final double radius;
  final double borderOpacity;
  final List<BoxShadow>? shadows;
  final double? width;
  final EdgeInsetsGeometry? margin;

  const WhiteCard({
    super.key,
    required this.child,
    this.pad = 24,
    this.radius = KioskTheme.radiusMd,
    this.borderOpacity = 0.06,
    this.shadows,
    this.width,
    this.margin,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      margin: margin,
      padding: EdgeInsets.all(pad),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(
          color: KioskTheme.lunaPink.withValues(alpha: borderOpacity),
        ),
        boxShadow: shadows ?? KioskTheme.shadowSm,
      ),
      child: child,
    );
  }
}

/// Horizontal metric card: colored icon circle + title/value.
/// [compact] selects the tighter lifetime-report sizing.
class MetricCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color color;
  final bool compact;

  const MetricCard({
    super.key,
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    return WhiteCard(
      pad: compact ? 20 : 24,
      radius: compact ? KioskTheme.radiusMd : KioskTheme.radiusLg,
      borderOpacity: compact ? 0.06 : 0.08,
      shadows: compact ? KioskTheme.shadowSm : KioskTheme.shadowMd,
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(compact ? 12 : 16),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: color, size: compact ? 24 : 28),
          ),
          SizedBox(width: compact ? 16 : 20),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: KioskTheme.labelMedium.copyWith(
                    color: KioskTheme.textMuted,
                    fontSize: compact ? 10 : 12,
                  ),
                ),
                SizedBox(height: compact ? 2 : 4),
                Text(
                  value,
                  style: KioskTheme.headerMedium.copyWith(
                    fontSize: compact ? 22 : 28,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
