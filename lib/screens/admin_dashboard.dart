import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/functions.dart';
import '../services/session.dart';
import '../services/cart_notifier.dart';
import '../services/order_service.dart';
import '../utils/format.dart';
import '../widgets/kiosk/kiosk_theme.dart';
import '../widgets/kiosk/juicy_feedback.dart';
import '../widgets/report/report_widgets.dart';
import 'menu_page.dart';
import 'analytics_page.dart';
import 'lifetime_analytics_page.dart';
import 'kds_page.dart';
import 'staff_login_dialog.dart';

class AdminDashboard extends StatefulWidget {
  const AdminDashboard({super.key});

  @override
  State<AdminDashboard> createState() => _AdminDashboardState();
}

class _AdminDashboardState extends State<AdminDashboard> {
  bool _loading = false;
  String? _error;
  int _totalRevenue = 0;
  int _orderCount = 0;
  int _avgOrderValue = 0;
  int _itemsSold = 0;
  List<Map<String, dynamic>> _recentOrders = [];
  bool _wasStaff = false;

  @override
  void initState() {
    super.initState();
    _wasStaff = session.isStaff;
    session.addListener(_onSessionChanged);
    if (_wasStaff) {
      _fetchDashboardData();
    }
  }

  void _onSessionChanged() {
    if (!mounted) return;
    final isStaffNow = session.isStaff;
    if (isStaffNow && !_wasStaff) {
      _wasStaff = true;
      _fetchDashboardData();
    } else if (!isStaffNow && _wasStaff) {
      _wasStaff = false;
      setState(() {
        _totalRevenue = 0;
        _orderCount = 0;
        _avgOrderValue = 0;
        _itemsSold = 0;
        _recentOrders = [];
        _error = null;
      });
    }
  }

  @override
  void dispose() {
    session.removeListener(_onSessionChanged);
    super.dispose();
  }

  Future<void> _fetchDashboardData() async {
    if (!session.isStaff) return;
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final results = await Future.wait([
        callFn('getSalesAnalytics'),
        callFn('getActiveOrders', {'includeCompleted': true}),
      ]);

      if (!mounted) return;
      final analytics = results[0];
      final ordersRes = results[1];

      final rawOrders = (ordersRes['orders'] as List<dynamic>?) ?? [];
      final mappedOrders = rawOrders.map<Map<String, dynamic>>((o) {
        final ts = DateTime.tryParse((o['timestamp'] ?? '').toString());
        final timeLabel = ts != null ? localStamp(ts.toLocal()) : '';
        final entryType = (o['entryType'] ?? '').toString();
        return {
          'orderNumber': (o['orderNumber'] ?? o['id'] ?? '').toString(),
          'customerName': (o['customerName'] ?? 'Customer').toString(),
          'type': (o['type'] ?? 'Pickup').toString(),
          'isWalkIn':
              entryType == 'Staff' ||
              (o['type'] ?? '').toString().toLowerCase().contains('walk-in'),
          'total': (o['total'] as num?)?.toInt() ?? 0,
          'time': timeLabel,
          'status': (o['status'] ?? 'Pending').toString(),
        };
      }).toList();

      int itemsCount = (analytics['totalItemsSold'] as num?)?.toInt() ?? 0;
      if (itemsCount == 0 && rawOrders.isNotEmpty) {
        final todayPrefix = phtDateLabel(DateTime.now());
        for (final o in rawOrders) {
          final ts = DateTime.tryParse((o['timestamp'] ?? '').toString());
          if (ts != null && phtDateLabel(ts) == todayPrefix) {
            itemsCount += (o['itemsCount'] as num?)?.toInt() ?? 0;
          }
        }
      }

      setState(() {
        if (analytics['success'] == true) {
          _totalRevenue = (analytics['totalRevenue'] as num?)?.toInt() ?? 0;
          _orderCount = (analytics['orderCount'] as num?)?.toInt() ?? 0;
          _avgOrderValue =
              (analytics['averageOrderValue'] as num?)?.toInt() ?? 0;
          _itemsSold = itemsCount;
        }
        if (ordersRes['success'] == true) {
          _recentOrders = mappedOrders;
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
            : 'Could not load dashboard data: ${e.message ?? e.code}';
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Error connecting to server. Tap RETRY to sync.';
        _loading = false;
      });
    }
  }

  void _logout() {
    session.logout();
    cartNotifier.clear();
    Navigator.pushNamedAndRemoveUntil(context, '/', (route) => false);
  }

  void _goToWalkIn() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const KioskMenuPage()),
    );
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
    final recentOrders = _recentOrders.isNotEmpty
        ? _recentOrders.take(10).toList()
        : orderHistory.reversed.take(10).toList();

    return Scaffold(
      backgroundColor: KioskTheme.lunaBlushPaper,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(isMobile ? 16 : 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildHeader(),
              if (_error != null) ...[
                const SizedBox(height: 16),
                _buildErrorBanner(),
              ],
              if (_loading) ...[
                const SizedBox(height: 16),
                const LinearProgressIndicator(
                  color: KioskTheme.lunaPink,
                  backgroundColor: KioskTheme.lunaPaper,
                ),
              ],
              const SizedBox(height: 28),
              _buildSectionTitle("TODAY'S OVERVIEW"),
              const SizedBox(height: 16),
              _buildStatsGrid(),
              const SizedBox(height: 32),
              _buildLiveKdsButton(),
              const SizedBox(height: 16),
              _buildWalkInButton(),
              const SizedBox(height: 32),
              _buildSectionTitle('QUICK ACTIONS'),
              const SizedBox(height: 16),
              _buildQuickActions(context, isMobile),
              const SizedBox(height: 32),
              _buildSectionTitle('RECENT ORDERS'),
              const SizedBox(height: 16),
              if (recentOrders.isEmpty)
                _buildEmptyState()
              else
                ...recentOrders.map((o) => _buildOrderTile(o)),
              const SizedBox(height: 40),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildErrorBanner() {
    final isAuthIssue =
        (_error ?? '').toLowerCase().contains('sign in') ||
        (_error ?? '').toLowerCase().contains('unauthenticated') ||
        (_error ?? '').toLowerCase().contains('permission-denied');
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFFCE4E4),
        borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
        border: Border.all(color: KioskTheme.error),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.warning_amber_rounded,
            color: KioskTheme.error,
            size: 18,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _error!,
              style: KioskTheme.bodySmall.copyWith(
                color: KioskTheme.textPrimary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          if (isAuthIssue)
            TextButton(
              onPressed: () => session.logout(),
              child: const Text('SIGN IN'),
            ),
          TextButton(
            onPressed: _fetchDashboardData,
            child: const Text('RETRY'),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: KioskTheme.brandGradient,
        borderRadius: BorderRadius.circular(KioskTheme.radiusLg),
        boxShadow: KioskTheme.shadowPrimary,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.25),
                    width: 1.5,
                  ),
                ),
                padding: const EdgeInsets.all(3),
                child: Center(
                  child: Image.asset(
                    'images/luna_logo.png',
                    height: 36,
                    excludeFromSemantics: true,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Luna Bites & Delights',
                      style: KioskTheme.font(
                        color: KioskTheme.textOnPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Welcome, ${session.username}!',
                      style: KioskTheme.font(
                        color: KioskTheme.textOnPrimary.withValues(alpha: 0.85),
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Refresh Dashboard',
                onPressed: _loading ? null : _fetchDashboardData,
                icon: const Icon(Icons.refresh_rounded, color: Colors.white),
              ),
              JuicyFeedback(
                onPressed: _logout,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 9,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(KioskTheme.radiusFull),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.3),
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.logout_rounded,
                        color: Colors.white.withValues(alpha: 0.9),
                        size: 16,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        'Logout',
                        style: KioskTheme.font(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(KioskTheme.radiusFull),
            ),
            child: Text(
              'ADMIN DASHBOARD',
              style: KioskTheme.font(
                color: KioskTheme.textOnPrimary,
                fontWeight: FontWeight.w800,
                fontSize: 11,
                letterSpacing: 2,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Text(
      title,
      style: KioskTheme.labelLarge.copyWith(
        color: KioskTheme.textMuted,
        fontSize: 13,
      ),
    );
  }

  Widget _buildStatsGrid() {
    final revenue = _totalRevenue > 0 ? _totalRevenue : todayRevenue;
    final count = _orderCount > 0 ? _orderCount : todayOrderCount;
    final avg = _avgOrderValue > 0 ? _avgOrderValue : avgOrderValue.round();
    final items = _itemsSold > 0 ? _itemsSold : todayItemsSold;

    return LayoutBuilder(
      builder: (_, constraints) => Wrap(
        spacing: 14,
        runSpacing: 14,
        children: [
          _statCard(
            'Today\'s Sales',
            '₱$revenue',
            Icons.trending_up_rounded,
            KioskTheme.success,
            (constraints.maxWidth - 14) / 2,
          ),
          _statCard(
            'Orders',
            '$count',
            Icons.receipt_long_rounded,
            KioskTheme.info,
            (constraints.maxWidth - 14) / 2,
          ),
          _statCard(
            'Avg order',
            '₱$avg',
            Icons.analytics_rounded,
            Colors.purple,
            (constraints.maxWidth - 14) / 2,
          ),
          _statCard(
            'Items sold',
            '$items',
            Icons.shopping_bag_rounded,
            KioskTheme.warning,
            (constraints.maxWidth - 14) / 2,
          ),
        ],
      ),
    );
  }

  Widget _statCard(
    String label,
    String value,
    IconData icon,
    Color color,
    double cardWidth,
  ) {
    return WhiteCard(
      width: cardWidth,
      pad: 18,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(KioskTheme.radiusSm),
            ),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(height: 14),
          Text(value, style: KioskTheme.headerMedium.copyWith(fontSize: 24)),
          const SizedBox(height: 2),
          Text(
            label,
            style: KioskTheme.bodySmall.copyWith(
              fontSize: 11,
              color: KioskTheme.textMuted,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLiveKdsButton() {
    return JuicyFeedback(
      onPressed: () {
        Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const KdsPage()),
        );
      },
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 20),
        decoration: BoxDecoration(
          color: KioskTheme.lunaPink,
          borderRadius: BorderRadius.circular(KioskTheme.radiusLg),
          boxShadow: KioskTheme.shadowPrimary,
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.18),
                borderRadius: BorderRadius.circular(KioskTheme.radiusSm),
              ),
              child: const Icon(
                Icons.outdoor_grill_rounded,
                color: KioskTheme.lunaButter,
                size: 24,
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'LIVE ORDERS KANBAN (KDS)',
                    style: KioskTheme.font(
                      color: KioskTheme.textOnPrimary,
                      fontWeight: FontWeight.w800,
                      fontSize: 15,
                      letterSpacing: 1,
                    ),
                  ),
                  Text(
                    'Kitchen display, audio alerts & dispatch queue',
                    style: KioskTheme.font(
                      color: KioskTheme.textOnPrimary,
                      fontWeight: FontWeight.w500,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.arrow_forward_rounded,
              color: KioskTheme.textOnPrimary,
              size: 22,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildWalkInButton() {
    return JuicyFeedback(
      onPressed: _goToWalkIn,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 20),
        decoration: BoxDecoration(
          color: KioskTheme.success,
          borderRadius: BorderRadius.circular(KioskTheme.radiusLg),
          boxShadow: KioskTheme.shadowMd,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(KioskTheme.radiusSm),
              ),
              child: const Icon(
                Icons.storefront_rounded,
                color: Colors.white,
                size: 24,
              ),
            ),
            const SizedBox(width: 16),
            Flexible(
              child: Text(
                'New Walk-in Order',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: KioskTheme.font(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: 18,
                  letterSpacing: 0.5,
                ),
              ),
            ),
            const SizedBox(width: 12),
            const Icon(
              Icons.arrow_forward_rounded,
              color: Colors.white,
              size: 22,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickActions(BuildContext context, bool isMobile) {
    final actions = [
      _ActionItem(
        icon: Icons.bar_chart_rounded,
        title: 'Sales Report',
        subtitle: 'View detailed analytics',
        color: KioskTheme.info,
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const AnalyticsPage()),
          );
        },
      ),
      _ActionItem(
        icon: Icons.receipt_long_rounded,
        title: 'Order History',
        subtitle: 'Recent orders',
        color: Colors.purple,
        onTap: () {
          final orders = _recentOrders.isNotEmpty
              ? _recentOrders
              : orderHistory.reversed.toList();
          if (orders.isEmpty) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  'No orders yet today.',
                  style: KioskTheme.font(fontWeight: FontWeight.w700),
                ),
                backgroundColor: KioskTheme.lunaPink,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
                ),
              ),
            );
            return;
          }
          _showOrdersSheet(context, orders);
        },
      ),
      _ActionItem(
        icon: Icons.menu_book_rounded,
        title: 'Menu Manager',
        subtitle: 'View menu items',
        color: KioskTheme.success,
        onTap: () => _goToWalkIn(),
      ),
      _ActionItem(
        icon: Icons.tv_rounded,
        title: 'KDS Display',
        subtitle: 'Kitchen display system',
        color: KioskTheme.warning,
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const KdsPage()),
          );
        },
      ),
    ];

    return Column(
      children: [
        LayoutBuilder(
          builder: (_, constraints) => Wrap(
            spacing: 14,
            runSpacing: 14,
            children: actions
                .map((a) => _actionCard(a, (constraints.maxWidth - 14) / 2))
                .toList(),
          ),
        ),
        const SizedBox(height: 14),
        _buildLifetimeReportButton(),
      ],
    );
  }

  Widget _buildLifetimeReportButton() {
    return JuicyFeedback(
      onPressed: () {
        Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const LifetimeAnalyticsPage()),
        );
      },
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 24),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [KioskTheme.lunaPink, KioskTheme.lunaInk],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
          boxShadow: KioskTheme.shadowPrimary,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(KioskTheme.radiusSm),
              ),
              child: const Icon(
                Icons.leaderboard_rounded,
                color: Colors.white,
                size: 22,
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'LIFETIME SALES REPORT',
                    style: KioskTheme.font(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 15,
                      letterSpacing: 1,
                    ),
                  ),
                  Text(
                    'Full history \u00B7 Best sellers \u00B7 Date filters',
                    style: KioskTheme.font(
                      color: Colors.white.withValues(alpha: 0.75),
                      fontWeight: FontWeight.w600,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Icon(
              Icons.arrow_forward_rounded,
              color: Colors.white.withValues(alpha: 0.8),
              size: 20,
            ),
          ],
        ),
      ),
    );
  }

  Widget _actionCard(_ActionItem item, double cardWidth) {
    return GestureDetector(
      onTap: item.onTap,
      child: WhiteCard(
        width: cardWidth,
        pad: 18,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: item.color.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(KioskTheme.radiusSm),
              ),
              child: Icon(item.icon, color: item.color, size: 22),
            ),
            const SizedBox(height: 12),
            Text(
              item.title,
              style: KioskTheme.labelLarge.copyWith(fontSize: 13),
            ),
            const SizedBox(height: 2),
            Text(
              item.subtitle,
              style: KioskTheme.bodySmall.copyWith(fontSize: 10),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
        border: Border.all(color: KioskTheme.lunaPink.withValues(alpha: 0.06)),
        boxShadow: KioskTheme.shadowSm,
      ),
      child: Column(
        children: [
          const Icon(
            Icons.receipt_long_outlined,
            size: 48,
            color: KioskTheme.pinkInk,
          ),
          const SizedBox(height: 16),
          Text(
            'No orders yet today',
            style: KioskTheme.titleMedium.copyWith(fontSize: 16),
          ),
          const SizedBox(height: 6),
          Text(
            'Start by placing a walk-in order!',
            style: KioskTheme.bodySmall.copyWith(fontSize: 13),
          ),
        ],
      ),
    );
  }

  Widget _buildOrderTile(Map<String, dynamic> order) {
    final type = order['isWalkIn'] == true
        ? 'Walk-In'
        : (order['type'] as String);
    final isWalkIn = order['isWalkIn'] == true;
    final typeIcon = isWalkIn
        ? Icons.receipt_long_outlined
        : (type == 'Pickup'
              ? Icons.storefront_outlined
              : Icons.delivery_dining_outlined);
    final typeColor = isWalkIn
        ? KioskTheme.success
        : (type == 'Pickup' ? KioskTheme.warning : KioskTheme.info);

    return WhiteCard(
      margin: const EdgeInsets.only(bottom: 12),
      pad: 16,
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: typeColor.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(KioskTheme.radiusSm),
            ),
            child: Center(child: Icon(typeIcon, size: 24, color: typeColor)),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      order['orderNumber'] as String,
                      style: KioskTheme.titleMedium.copyWith(fontSize: 14),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: typeColor.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(
                          KioskTheme.radiusFull,
                        ),
                      ),
                      child: Text(
                        type,
                        style: KioskTheme.font(
                          fontSize: 9,
                          fontWeight: FontWeight.w800,
                          color: typeColor,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  '${order['customerName']}  ·  ${order['time']}',
                  style: KioskTheme.bodySmall.copyWith(fontSize: 11),
                ),
              ],
            ),
          ),
          Text(
            '₱${order['total']}',
            style: KioskTheme.headerSmall.copyWith(
              fontSize: 20,
              color: KioskTheme.lunaPink,
            ),
          ),
        ],
      ),
    );
  }

  void _showOrdersSheet(
    BuildContext context,
    List<Map<String, dynamic>> orders,
  ) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => Container(
        height: MediaQuery.of(context).size.height * 0.75,
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(KioskTheme.radiusXl),
          ),
        ),
        child: Column(
          children: [
            Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(top: 14, bottom: 10),
              decoration: BoxDecoration(
                color: Colors.grey[300],
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 8),
              child: Row(
                children: [
                  Text(
                    'All orders',
                    style: KioskTheme.headerSmall.copyWith(fontSize: 18),
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: KioskTheme.lunaPink.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(
                        KioskTheme.radiusFull,
                      ),
                    ),
                    child: Text(
                      '${orders.length} total',
                      style: KioskTheme.labelSmall.copyWith(
                        color: KioskTheme.lunaPink,
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            KioskTheme.divider(),
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.all(20),
                itemCount: orders.length,
                itemBuilder: (_, i) => _buildOrderTile(orders[i]),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActionItem {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  const _ActionItem({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });
}
