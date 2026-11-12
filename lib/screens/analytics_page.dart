import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/functions.dart';
import '../services/session.dart';
import '../widgets/kiosk/kiosk_theme.dart';
import '../widgets/report/report_widgets.dart';
import 'staff_login_dialog.dart';

class AnalyticsPage extends StatefulWidget {
  const AnalyticsPage({super.key});

  @override
  State<AnalyticsPage> createState() => _AnalyticsPageState();
}

class _AnalyticsPageState extends State<AnalyticsPage> {
  bool _loading = false;
  Map<String, dynamic> _data = {};
  String? _error;
  bool _wasStaff = false;

  @override
  void initState() {
    super.initState();
    _wasStaff = session.isStaff;
    session.addListener(_onSessionChanged);
    if (_wasStaff) {
      _fetchAnalytics();
    }
  }

  void _onSessionChanged() {
    if (!mounted) return;
    final isStaffNow = session.isStaff;
    if (isStaffNow && !_wasStaff) {
      _wasStaff = true;
      _fetchAnalytics();
    } else if (!isStaffNow && _wasStaff) {
      _wasStaff = false;
      setState(() {
        _data = {};
        _error = null;
      });
    }
  }

  @override
  void dispose() {
    session.removeListener(_onSessionChanged);
    super.dispose();
  }

  Future<void> _fetchAnalytics() async {
    if (!session.isStaff) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await callFn('getSalesAnalytics');
      if (!mounted) return;
      setState(() {
        if (data['success'] == true) {
          _data = data;
        } else {
          _error = data['message'] ?? 'Failed to load analytics.';
        }
        _loading = false;
      });
    } on FirebaseFunctionsException catch (e) {
      if (!mounted) return;
      final isAuthError =
          e.code == 'unauthenticated' || e.code == 'permission-denied';
      if (isAuthError) {
        session.logout();
      }
      setState(() {
        _error = isAuthError
            ? 'Staff session expired (${e.code}). Please sign in again.'
            : 'Could not load analytics: ${e.message ?? e.code}';
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Error connecting to server. Please try again.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final sessionWatcher = context.watch<Session>();
    if (!sessionWatcher.isStaff) {
      return const Scaffold(
        backgroundColor: KioskTheme.lunaBlushPaper,
        body: Center(
          child: SingleChildScrollView(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: StaffLoginDialog(),
          ),
        ),
      );
    }

    final isMobile = MediaQuery.of(context).size.width < 800;

    return ReportScaffold(
      title: 'SALES DASHBOARD',
      loading: _loading,
      error: _error,
      onRetry: _fetchAnalytics,
      onRefresh: _loading ? null : _fetchAnalytics,
      refreshTooltip: 'Refresh Metrics',
      body: SingleChildScrollView(
        padding: EdgeInsets.all(isMobile ? 16 : 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 12,
              runSpacing: 10,
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'TODAY\'S REVENUE METRICS',
                      style: KioskTheme.labelMedium.copyWith(
                        color: KioskTheme.textMuted,
                        fontSize: 13,
                      ),
                    ),
                    Text(
                      _data['dateLabel'] ?? 'Date loading...',
                      style: KioskTheme.headerMedium.copyWith(
                        fontSize: isMobile ? 20 : 24,
                      ),
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 7,
                  ),
                  decoration: KioskTheme.badgeSuccess,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.check_circle_rounded,
                        color: KioskTheme.success,
                        size: 16,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'LIVE SYNCED',
                        style: KioskTheme.labelSmall.copyWith(
                          color: KioskTheme.success,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 32),
            _metrics(isMobile),
            const SizedBox(height: 32),
            isMobile
                ? Column(
                    children: [
                      _buildSplitCard(),
                      const SizedBox(height: 32),
                      _buildTopItemsCard(),
                    ],
                  )
                : Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(flex: 3, child: _buildSplitCard()),
                      const SizedBox(width: 24),
                      Expanded(flex: 2, child: _buildTopItemsCard()),
                    ],
                  ),
          ],
        ),
      ),
    );
  }

  Widget _metrics(bool isMobile) {
    final cards = [
      MetricCard(
        title: 'TOTAL REVENUE',
        value: '₱${_data['totalRevenue'] ?? 0}',
        icon: Icons.monetization_on_rounded,
        color: KioskTheme.success,
      ),
      MetricCard(
        title: 'TICKET COUNT',
        value: '${_data['orderCount'] ?? 0}',
        icon: Icons.receipt_long_rounded,
        color: KioskTheme.info,
      ),
      MetricCard(
        title: 'AVG TICKET',
        value: '₱${_data['averageOrderValue'] ?? 0}',
        icon: Icons.analytics_rounded,
        color: Colors.purple,
      ),
    ];
    if (isMobile) {
      return Column(
        children: [
          cards[0],
          const SizedBox(height: 16),
          cards[1],
          const SizedBox(height: 16),
          cards[2],
        ],
      );
    }
    return Row(
      children: [
        Expanded(child: cards[0]),
        const SizedBox(width: 20),
        Expanded(child: cards[1]),
        const SizedBox(width: 20),
        Expanded(child: cards[2]),
      ],
    );
  }

  Widget _buildSplitCard() {
    final breakdown = _data['breakdown'] as Map? ?? {};
    int rev(String key) => (breakdown[key] as Map?)?['revenue'] as int? ?? 0;

    final walkInRev = rev('walkIn');
    final deliveryRev = rev('delivery');
    final pickupRev = rev('pickup');
    final maxRev = [
      walkInRev,
      deliveryRev,
      pickupRev,
    ].reduce((a, b) => a > b ? a : b);

    return WhiteCard(
      pad: 28,
      radius: KioskTheme.radiusLg,
      borderOpacity: 0.08,
      shadows: const [],
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'CHANNEL SALES SPLIT',
            style: KioskTheme.labelLarge.copyWith(fontSize: 15),
          ),
          KioskTheme.divider(),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              _buildChartBar('Walk-In', walkInRev, maxRev, Colors.orange),
              _buildChartBar('Pickup', pickupRev, maxRev, KioskTheme.info),
              _buildChartBar('Delivery', deliveryRev, maxRev, Colors.purple),
            ],
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  Widget _buildChartBar(String label, int value, int maxValue, Color barColor) {
    final double heightFactor = maxValue > 0 ? (value / maxValue) : 0.05;
    final double barHeight = 15.0 + (heightFactor * 135.0);

    return Column(
      children: [
        Text('₱$value', style: KioskTheme.titleMedium.copyWith(fontSize: 13)),
        const SizedBox(height: 8),
        Container(
          width: 48,
          height: barHeight,
          decoration: BoxDecoration(
            color: barColor,
            borderRadius: const BorderRadius.vertical(
              top: Radius.circular(KioskTheme.radiusSm),
            ),
            boxShadow: [
              BoxShadow(
                color: barColor.withValues(alpha: 0.2),
                blurRadius: 8,
                offset: const Offset(0, 4),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Text(
          label,
          style: KioskTheme.labelMedium.copyWith(
            color: KioskTheme.textMuted,
            fontSize: 12,
          ),
        ),
      ],
    );
  }

  Widget _buildTopItemsCard() {
    final topItems = _data['topItems'] as List? ?? [];

    return WhiteCard(
      pad: 28,
      radius: KioskTheme.radiusLg,
      borderOpacity: 0.08,
      shadows: const [],
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'TOP Menu ITEMS',
            style: KioskTheme.labelLarge.copyWith(fontSize: 15),
          ),
          KioskTheme.divider(),
          if (topItems.isEmpty)
            Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 40.0),
                child: Text(
                  'No item sales recorded today',
                  style: KioskTheme.bodySmall.copyWith(
                    color: Colors.grey[400],
                    fontSize: 13,
                  ),
                ),
              ),
            )
          else
            ...topItems.asMap().entries.map((entry) {
              final idx = entry.key + 1;
              final item = entry.value;
              return Padding(
                padding: const EdgeInsets.only(bottom: 16.0),
                child: Row(
                  children: [
                    Container(
                      width: 24,
                      height: 24,
                      decoration: BoxDecoration(
                        color: KioskTheme.lunaPink.withValues(alpha: 0.05),
                        shape: BoxShape.circle,
                      ),
                      child: Center(
                        child: Text(
                          '$idx',
                          style: KioskTheme.labelSmall.copyWith(
                            color: KioskTheme.textPrimary,
                            fontSize: 11,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        item['name'] as String,
                        style: KioskTheme.titleMedium.copyWith(fontSize: 13),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: KioskTheme.lunaPink.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(
                          KioskTheme.radiusSm,
                        ),
                      ),
                      child: Text(
                        '${item['count']} sold',
                        style: KioskTheme.labelSmall.copyWith(
                          color: KioskTheme.textPrimary,
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ],
                ),
              );
            }),
        ],
      ),
    );
  }
}
