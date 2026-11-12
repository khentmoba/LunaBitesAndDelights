import 'package:flutter/material.dart';
import '../services/functions.dart';
import '../utils/format.dart';
import '../widgets/kiosk/kiosk_theme.dart';
import '../widgets/report/report_widgets.dart';

/// Quick date-range preset for the lifetime report.
enum DateRangePreset {
  allTime('All Time'),
  today('Today'),
  thisWeek('This Week'),
  thisMonth('This Month'),
  thisYear('This Year'),
  custom('Custom');

  final String label;
  const DateRangePreset(this.label);
}

class LifetimeAnalyticsPage extends StatefulWidget {
  const LifetimeAnalyticsPage({super.key});

  @override
  State<LifetimeAnalyticsPage> createState() => _LifetimeAnalyticsPageState();
}

class _LifetimeAnalyticsPageState extends State<LifetimeAnalyticsPage> {
  bool _loading = false;
  Map<String, dynamic> _data = {};
  String? _error;

  DateRangePreset _selectedPreset = DateRangePreset.allTime;
  DateTime? _customStart;
  DateTime? _customEnd;

  @override
  void initState() {
    super.initState();
    _fetchReport();
  }

  String _computeStartDate() {
    if (_selectedPreset == DateRangePreset.custom && _customStart != null) {
      return phtDateLabel(_customStart);
    }
    final nowPht = phtNow();
    final today = DateTime(nowPht.year, nowPht.month, nowPht.day);
    switch (_selectedPreset) {
      case DateRangePreset.today:
        return phtDateLabel();
      case DateRangePreset.thisWeek:
        return phtDateLabel(today.subtract(Duration(days: today.weekday - 1)));
      case DateRangePreset.thisMonth:
        return phtDateLabel(DateTime(today.year, today.month, 1));
      case DateRangePreset.thisYear:
        return phtDateLabel(DateTime(today.year, 1, 1));
      default:
        return '2020-01-01'; // all time
    }
  }

  String _computeEndDate() {
    if (_selectedPreset == DateRangePreset.custom && _customEnd != null) {
      return phtDateLabel(_customEnd);
    }
    return phtDateLabel(); // today
  }

  Future<void> _fetchReport() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await callFn('getLifetimeSalesReport', {
        'startDate': _computeStartDate(),
        'endDate': _computeEndDate(),
      });
      setState(() {
        if (data['success'] == true) {
          _data = data;
        } else {
          _error = data['message'] ?? 'Failed to load report.';
        }
        _loading = false;
      });
    } catch (_) {
      setState(() {
        _error = 'Error connecting to server. Please try again.';
        _loading = false;
      });
    }
  }

  String get _rangeLabel {
    final dateRange = _data['dateRange'] as Map?;
    if (dateRange?['isAllTime'] == true) return 'LIFETIME (ALL TIME)';
    return '${dateRange?['start'] ?? '?'}  →  ${dateRange?['end'] ?? '?'}';
  }

  @override
  Widget build(BuildContext context) {
    final isMobile = MediaQuery.of(context).size.width < 800;

    return ReportScaffold(
      title: 'LIFETIME SALES REPORT',
      loading: _loading,
      error: _error,
      onRetry: _fetchReport,
      onRefresh: _loading ? null : _fetchReport,
      body: Column(
        children: [
          _buildDateFilterBar(),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 16, 24, 40),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildRangeHeader(),
                  const SizedBox(height: 24),
                  _buildSummaryRow(isMobile),
                  const SizedBox(height: 24),
                  _buildDailyRevenueChart(),
                  const SizedBox(height: 24),
                  isMobile
                      ? Column(
                          children: [
                            _buildChannelBreakdownCard(),
                            const SizedBox(height: 20),
                            _buildEntryTypeCard(),
                            const SizedBox(height: 20),
                            _buildPaymentMethodCard(),
                            const SizedBox(height: 20),
                            _buildTopItemsCard(),
                          ],
                        )
                      : Column(
                          children: [
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  flex: 2,
                                  child: _buildChannelBreakdownCard(),
                                ),
                                const SizedBox(width: 20),
                                Expanded(flex: 1, child: _buildEntryTypeCard()),
                              ],
                            ),
                            const SizedBox(height: 20),
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  flex: 1,
                                  child: _buildPaymentMethodCard(),
                                ),
                                const SizedBox(width: 20),
                                Expanded(flex: 2, child: _buildTopItemsCard()),
                              ],
                            ),
                          ],
                        ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDateFilterBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(
          bottom: BorderSide(
            color: KioskTheme.lunaPink.withValues(alpha: 0.06),
          ),
        ),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: DateRangePreset.values.map((preset) {
            final selected = _selectedPreset == preset;
            return Padding(
              padding: const EdgeInsets.only(right: 8),
              child: GestureDetector(
                onTap: () => _onPresetTap(preset),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: selected ? KioskTheme.lunaPink : Colors.transparent,
                    borderRadius: BorderRadius.circular(KioskTheme.radiusFull),
                    border: Border.all(
                      color: selected
                          ? KioskTheme.lunaPink
                          : KioskTheme.textMuted.withValues(alpha: 0.3),
                    ),
                  ),
                  child: Text(
                    preset.label,
                    style: KioskTheme.font(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: selected ? Colors.white : KioskTheme.textMuted,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
              ),
            );
          }).toList(),
        ),
      ),
    );
  }

  void _onPresetTap(DateRangePreset preset) async {
    if (preset == DateRangePreset.custom) {
      final picked = await showDateRangePicker(
        context: context,
        firstDate: DateTime(2020, 1, 1),
        lastDate: phtNow(),
        initialDateRange: _customStart != null && _customEnd != null
            ? DateTimeRange(start: _customStart!, end: _customEnd!)
            : DateTimeRange(
                start: DateTime.now().subtract(const Duration(days: 30)),
                end: DateTime.now(),
              ),
        builder: (ctx, child) {
          return Theme(
            data: Theme.of(ctx).copyWith(
              colorScheme: Theme.of(ctx).colorScheme.copyWith(
                primary: KioskTheme.lunaPink,
                onPrimary: Colors.white,
              ),
            ),
            child: child!,
          );
        },
      );
      if (picked != null) {
        setState(() {
          _customStart = picked.start;
          _customEnd = picked.end;
          _selectedPreset = DateRangePreset.custom;
        });
        _fetchReport();
      }
      return;
    }

    setState(() => _selectedPreset = preset);
    _fetchReport();
  }

  Widget _buildRangeHeader() {
    final summary = _data['summary'] as Map? ?? {};
    final orderCount = summary['orderCount'] as int? ?? 0;

    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'SALES OVERVIEW',
              style: KioskTheme.labelMedium.copyWith(
                color: KioskTheme.textMuted,
                fontSize: 14,
              ),
            ),
            Text(
              _rangeLabel,
              style: KioskTheme.headerMedium.copyWith(fontSize: 20),
            ),
          ],
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
          decoration: BoxDecoration(
            color: KioskTheme.lunaPink.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(KioskTheme.radiusFull),
          ),
          child: Text(
            '$orderCount orders',
            style: KioskTheme.labelSmall.copyWith(
              color: KioskTheme.lunaPink,
              fontSize: 11,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildSummaryRow(bool isMobile) {
    final summary = _data['summary'] as Map? ?? {};
    final cards = [
      MetricCard(
        compact: true,
        title: 'TOTAL REVENUE',
        value: '₱${_fmt(summary['totalRevenue'] as int? ?? 0)}',
        icon: Icons.monetization_on_rounded,
        color: KioskTheme.success,
      ),
      MetricCard(
        compact: true,
        title: 'TOTAL ORDERS',
        value: _fmt(summary['orderCount'] as int? ?? 0),
        icon: Icons.receipt_long_rounded,
        color: KioskTheme.info,
      ),
      MetricCard(
        compact: true,
        title: 'AVG ORDER',
        value: '₱${_fmt(summary['averageOrderValue'] as int? ?? 0)}',
        icon: Icons.analytics_rounded,
        color: Colors.purple,
      ),
      MetricCard(
        compact: true,
        title: 'ITEMS SOLD',
        value: _fmt(summary['totalItemsSold'] as int? ?? 0),
        icon: Icons.shopping_bag_rounded,
        color: KioskTheme.warning,
      ),
    ];

    if (isMobile) {
      return Column(
        children: cards
            .map(
              (c) =>
                  Padding(padding: const EdgeInsets.only(bottom: 12), child: c),
            )
            .toList(),
      );
    }
    return Row(
      children: cards
          .map(
            (c) => Expanded(
              child: Padding(
                padding: const EdgeInsets.only(right: 12),
                child: c,
              ),
            ),
          )
          .toList(),
    );
  }

  Widget _buildDailyRevenueChart() {
    final series = (_data['dailySeries'] as List?) ?? [];

    if (series.isEmpty) {
      return WhiteCard(
        pad: 28,
        child: Center(
          child: Text(
            'No sales data for this period',
            style: KioskTheme.bodySmall.copyWith(
              color: Colors.grey[400],
              fontSize: 13,
            ),
          ),
        ),
      );
    }

    // Group by month for a manageable chart
    final monthlyData = <String, int>{};
    final monthlyOrders = <String, int>{};
    for (final day in series) {
      final date = day['date'] as String;
      final month = date.substring(0, 7); // YYYY-MM
      monthlyData[month] =
          (monthlyData[month] ?? 0) + (day['revenue'] as int? ?? 0);
      monthlyOrders[month] =
          (monthlyOrders[month] ?? 0) + (day['orders'] as int? ?? 0);
    }

    final sortedMonths = monthlyData.keys.toList()..sort();
    final maxRev = monthlyData.values.reduce((a, b) => a > b ? a : b);

    return WhiteCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'REVENUE OVER TIME',
                style: KioskTheme.labelLarge.copyWith(fontSize: 14),
              ),
              const SizedBox(width: 8),
              Text(
                '(Monthly)',
                style: KioskTheme.bodySmall.copyWith(
                  color: KioskTheme.textMuted,
                  fontSize: 11,
                ),
              ),
            ],
          ),
          KioskTheme.divider(),
          const SizedBox(height: 20),
          SizedBox(
            height: 160,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: sortedMonths.length,
              itemBuilder: (_, i) {
                final month = sortedMonths[i];
                final rev = monthlyData[month] ?? 0;
                final oCount = monthlyOrders[month] ?? 0;
                final heightFactor = maxRev > 0 ? rev / maxRev : 0.05;
                final barHeight = 20.0 + (heightFactor * 100.0);

                final parts = month.split('-');
                final label =
                    '${_monthsAbbr[int.parse(parts[1]) - 1]} ${parts.length > 1 ? "'${parts[1]}" : ""}';

                return Container(
                  width: 60,
                  margin: const EdgeInsets.only(right: 8),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      Text(
                        '₱${_shortFmt(rev)}',
                        style: KioskTheme.font(
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                          color: KioskTheme.textMuted,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '$oCount orders',
                        style: KioskTheme.font(
                          fontSize: 7,
                          fontWeight: FontWeight.w600,
                          color: KioskTheme.textMuted.withValues(alpha: 0.6),
                        ),
                      ),
                      const SizedBox(height: 2),
                      Container(
                        width: 28,
                        height: barHeight,
                        decoration: const BoxDecoration(
                          gradient: LinearGradient(
                            colors: [KioskTheme.lunaPink, KioskTheme.lunaInk],
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                          ),
                          borderRadius: BorderRadius.vertical(
                            top: Radius.circular(4),
                          ),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        label,
                        style: KioskTheme.font(
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                          color: KioskTheme.textSecondary,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildChannelBreakdownCard() {
    final breakdown = _data['breakdown'] as Map? ?? {};
    final channel = breakdown['channel'] as Map? ?? {};
    int rev(String key) => (channel[key] as Map?)?['revenue'] as int? ?? 0;
    int count(String key) => (channel[key] as Map?)?['count'] as int? ?? 0;

    final maxRev = [
      rev('walkIn'),
      rev('delivery'),
      rev('pickup'),
    ].reduce((a, b) => a > b ? a : b);

    return WhiteCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'CHANNEL SALES SPLIT',
            style: KioskTheme.labelLarge.copyWith(fontSize: 14),
          ),
          KioskTheme.divider(),
          const SizedBox(height: 20),
          _buildSplitBar(
            'Walk-In',
            rev('walkIn'),
            count('walkIn'),
            maxRev,
            Colors.orange,
          ),
          const SizedBox(height: 16),
          _buildSplitBar(
            'Pickup',
            rev('pickup'),
            count('pickup'),
            maxRev,
            KioskTheme.info,
          ),
          const SizedBox(height: 16),
          _buildSplitBar(
            'Delivery',
            rev('delivery'),
            count('delivery'),
            maxRev,
            Colors.purple,
          ),
        ],
      ),
    );
  }

  Widget _buildSplitBar(
    String label,
    int revenue,
    int count,
    int maxRev,
    Color color,
  ) {
    final fraction = maxRev > 0 ? revenue / maxRev : 0.0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: KioskTheme.titleMedium.copyWith(fontSize: 13)),
            Text(
              '₱${_fmt(revenue)}  ·  $count orders',
              style: KioskTheme.bodySmall.copyWith(fontSize: 11),
            ),
          ],
        ),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: fraction,
            backgroundColor: color.withValues(alpha: 0.1),
            valueColor: AlwaysStoppedAnimation<Color>(color),
            minHeight: 10,
          ),
        ),
      ],
    );
  }

  Widget _buildEntryTypeCard() {
    final breakdown = _data['breakdown'] as Map? ?? {};
    final entry = breakdown['entryType'] as Map? ?? {};
    int rev(String key) => (entry[key] as Map?)?['revenue'] as int? ?? 0;
    int count(String key) => (entry[key] as Map?)?['count'] as int? ?? 0;
    final totalRev = rev('kiosk') + rev('staff');

    return WhiteCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'ORDER ENTRY',
            style: KioskTheme.labelLarge.copyWith(fontSize: 14),
          ),
          KioskTheme.divider(),
          const SizedBox(height: 20),
          _buildMiniStat(
            'Kiosk',
            '₱${_fmt(rev('kiosk'))}',
            '${count('kiosk')} orders',
            KioskTheme.info,
          ),
          const SizedBox(height: 16),
          _buildMiniStat(
            'Staff',
            '₱${_fmt(rev('staff'))}',
            '${count('staff')} orders',
            Colors.orange,
          ),
          const SizedBox(height: 16),
          if (totalRev > 0) ...[
            KioskTheme.divider(),
            const SizedBox(height: 12),
            Text(
              'Kiosk: ${(rev('kiosk') / totalRev * 100).toStringAsFixed(1)}%  ·  Staff: ${(rev('staff') / totalRev * 100).toStringAsFixed(1)}%',
              style: KioskTheme.bodySmall.copyWith(fontSize: 11),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPaymentMethodCard() {
    final breakdown = _data['breakdown'] as Map? ?? {};
    final pm = breakdown['paymentMethod'] as Map? ?? {};
    int rev(String key) => (pm[key] as Map?)?['revenue'] as int? ?? 0;
    int count(String key) => (pm[key] as Map?)?['count'] as int? ?? 0;
    final totalRev = rev('cash') + rev('gcash');

    return WhiteCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'PAYMENT METHOD',
            style: KioskTheme.labelLarge.copyWith(fontSize: 14),
          ),
          KioskTheme.divider(),
          const SizedBox(height: 20),
          _buildMiniStat(
            'Cash',
            '₱${_fmt(rev('cash'))}',
            '${count('cash')} orders',
            KioskTheme.success,
          ),
          const SizedBox(height: 16),
          _buildMiniStat(
            'GCash',
            '₱${_fmt(rev('gcash'))}',
            '${count('gcash')} orders',
            KioskTheme.info,
          ),
          const SizedBox(height: 16),
          if (totalRev > 0) ...[
            KioskTheme.divider(),
            const SizedBox(height: 12),
            Text(
              'Cash: ${(rev('cash') / totalRev * 100).toStringAsFixed(1)}%  ·  GCash: ${(rev('gcash') / totalRev * 100).toStringAsFixed(1)}%',
              style: KioskTheme.bodySmall.copyWith(fontSize: 11),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildMiniStat(String label, String value, String sub, Color color) {
    return Row(
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: KioskTheme.titleMedium.copyWith(fontSize: 13)),
              Text(sub, style: KioskTheme.bodySmall.copyWith(fontSize: 10)),
            ],
          ),
        ),
        Text(value, style: KioskTheme.headerSmall.copyWith(fontSize: 16)),
      ],
    );
  }

  Widget _buildTopItemsCard() {
    final topItems = _data['topItems'] as List? ?? [];

    return WhiteCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'BEST SELLERS',
            style: KioskTheme.labelLarge.copyWith(fontSize: 14),
          ),
          const SizedBox(width: 4),
          Text(
            'Top items by quantity sold',
            style: KioskTheme.bodySmall.copyWith(fontSize: 10),
          ),
          KioskTheme.divider(),
          const SizedBox(height: 16),
          if (topItems.isEmpty)
            Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 32),
                child: Text(
                  'No item sales recorded',
                  style: KioskTheme.bodySmall.copyWith(
                    color: Colors.grey[400],
                    fontSize: 13,
                  ),
                ),
              ),
            )
          else
            ...topItems.asMap().entries.map((entry) {
              final idx = entry.key;
              final item = entry.value;
              final name = item['name'] as String;
              final qty = item['quantity'] as int;
              final rev = item['revenue'] as int? ?? 0;

              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(
                  children: [
                    Container(
                      width: 26,
                      height: 26,
                      decoration: BoxDecoration(
                        color: idx < 3
                            ? [
                                KioskTheme.lunaPink,
                                KioskTheme.textSecondary,
                                KioskTheme.textMuted,
                              ][idx]
                            : KioskTheme.lunaPink.withValues(alpha: 0.05),
                        borderRadius: BorderRadius.circular(
                          KioskTheme.radiusSm,
                        ),
                      ),
                      child: Center(
                        child: Text(
                          '#${idx + 1}',
                          style: KioskTheme.font(
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            color: idx < 3
                                ? Colors.white
                                : KioskTheme.textMuted,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            name,
                            style: KioskTheme.titleMedium.copyWith(
                              fontSize: 12,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            '₱${_fmt(rev)} total',
                            style: KioskTheme.bodySmall.copyWith(fontSize: 9),
                          ),
                        ],
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
                        '$qty sold',
                        style: KioskTheme.font(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: KioskTheme.lunaPink,
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

  String _fmt(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return n.toString();
  }

  String _shortFmt(int n) {
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return n.toString();
  }

  static const _monthsAbbr = [
    'J',
    'F',
    'M',
    'A',
    'M',
    'J',
    'J',
    'A',
    'S',
    'O',
    'N',
    'D',
  ];
}
