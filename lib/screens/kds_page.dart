import 'dart:async';
import 'package:flutter/material.dart' hide MenuTheme;
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../services/functions.dart';
import '../services/session.dart';
import '../services/audio_alert_service.dart';
import '../services/url_helper.dart';
import '../widgets/kiosk/menu_theme.dart';
import 'admin_dashboard.dart';
import 'menu_page.dart';
import 'staff_login_dialog.dart';

class KdsPage extends StatefulWidget {
  const KdsPage({super.key});

  @override
  State<KdsPage> createState() => _KdsPageState();
}

class _KdsPageState extends State<KdsPage> with SingleTickerProviderStateMixin {
  bool _loading = false;
  List<dynamic> _orders = [];
  String? _error;
  Timer? _refreshTimer;
  Timer? _clockTimer;
  DateTime _now = DateTime.now();
  int _secondsUntilSync = 10;
  String _typeFilter = 'ALL'; // ALL, Delivery, Pickup, Walk-In
  bool _showCompleted = false;
  String _searchQuery = '';
  final _searchCtrl = TextEditingController();

  Set<String> _knownPendingOrderIds = {};
  bool _hasInitialFetchDone = false;
  final Set<String> _checkedItemKeys = {};

  TabController? _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _fetchActiveOrders();
    _refreshTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {
        if (_secondsUntilSync > 1) {
          _secondsUntilSync--;
        } else {
          _secondsUntilSync = 10;
          _fetchActiveOrders(silent: true);
        }
      });
    });

    _clockTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (!mounted) return;
      setState(() => _now = DateTime.now());
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _clockTimer?.cancel();
    _tabController?.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchActiveOrders({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    setState(() => _error = null);

    try {
      final data = await callFn('getActiveOrders', {
        'includeCompleted': _showCompleted,
      });

      if (!mounted) return;

      if (data['success'] == true) {
        final freshOrders = (data['orders'] as List<dynamic>?) ?? [];
        _checkNewOrdersAndChime(freshOrders);
        setState(() {
          _orders = freshOrders;
          _loading = false;
        });
      } else {
        setState(() {
          _error = data['message'] ?? 'Failed to load active orders.';
          _loading = false;
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        if (_orders.isEmpty) {
          _orders = _sampleKdsOrders();
        }
        _loading = false;
      });
    }
  }

  static List<dynamic> _sampleKdsOrders() => [
    {
      'id': 'ord_del_101',
      'orderNumber': '2026-10-24-001',
      'customerName': 'Maria Santos',
      'customerPhone': '09171234567',
      'customerAddress': 'Purok 5, Magallanes (Near 7/11)',
      'lat': 9.0163,
      'lng': 125.5186,
      'deliveryFee': 0,
      'paymentMethod': 'GCash',
      'paymentStatus': 'PAID',
      'type': 'Delivery',
      'status': 'Pending',
      'timestamp': DateTime.now()
          .subtract(const Duration(minutes: 3))
          .toIso8601String(),
      'total': 198,
      'items': [
        {
          'name': 'Shawarma Wrap',
          'quantity': 1,
          'variant': 'Buy 1 Take 1',
          'price': 99,
        },
        {
          'name': 'Nachos & Fries Overload',
          'quantity': 1,
          'variant': 'Buddy (1–2 pax)',
          'price': 99,
        },
      ],
    },
    {
      'id': 'ord_prep_102',
      'orderNumber': '2026-10-24-002',
      'customerName': 'Juan Dela Cruz',
      'customerPhone': '09289876543',
      'customerAddress': '',
      'lat': null,
      'lng': null,
      'deliveryFee': 0,
      'paymentMethod': 'Cash',
      'paymentStatus': 'NOT PAID',
      'type': 'Pickup',
      'status': 'Preparing',
      'timestamp': DateTime.now()
          .subtract(const Duration(minutes: 9))
          .toIso8601String(),
      'total': 99,
      'items': [
        {
          'name': 'Buy 1 Take 1 Burger Favorites',
          'quantity': 1,
          'variant': 'Regular',
          'price': 99,
        },
      ],
    },
    {
      'id': 'ord_rdy_103',
      'orderNumber': '2026-10-24-003',
      'customerName': 'Counter Customer',
      'customerPhone': '',
      'customerAddress': '',
      'lat': null,
      'lng': null,
      'deliveryFee': 0,
      'paymentMethod': 'Cash',
      'paymentStatus': 'PAID',
      'type': 'Walk-In',
      'entryType': 'Staff',
      'status': 'Ready',
      'timestamp': DateTime.now()
          .subtract(const Duration(minutes: 14))
          .toIso8601String(),
      'total': 98,
      'items': [
        {'name': 'Classic Lemonade', 'quantity': 2, 'variant': '', 'price': 49},
      ],
    },
  ];

  void _checkNewOrdersAndChime(List<dynamic> freshOrders) {
    final pendingOrders = freshOrders
        .where((o) => o['status'] == 'Pending')
        .toList();
    final freshPendingIds = pendingOrders
        .map((o) => (o['id'] ?? o['orderNumber']).toString())
        .toSet();

    if (_hasInitialFetchDone) {
      final newArrivals = freshPendingIds.difference(_knownPendingOrderIds);
      if (newArrivals.isNotEmpty) {
        AudioAlertService.playOrderChime();
        if (mounted) {
          _snack(
            'New order received (${newArrivals.length} incoming)',
            MenuTheme.plate,
          );
        }
      }
    }
    _knownPendingOrderIds = freshPendingIds;
    _hasInitialFetchDone = true;
  }

  Future<void> _updateStatus(String orderId, String newStatus) async {
    setState(() => _loading = true);
    try {
      final data = await callFn('updateOrderStatus', {
        'orderId': orderId,
        'status': newStatus,
      });

      if (!mounted) return;

      if (data['success'] == true) {
        await _fetchActiveOrders(silent: true);
        if (mounted) {
          _snack('Order updated: $newStatus', const Color(0xFF1E7A3C));
        }
      } else {
        setState(() => _loading = false);
        if (mounted) {
          _snack('Error: ${data['message']}', const Color(0xFFB3261E));
        }
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
      _snack(
        'Failed to update status. Connection error.',
        const Color(0xFFB3261E),
      );
    }
  }

  void _snack(String msg, Color color) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          msg,
          style: MenuTheme.body(
            size: 13,
            color: Colors.white,
          ).copyWith(fontWeight: FontWeight.w700),
        ),
        backgroundColor: color,
        shape: const RoundedRectangleBorder(),
        duration: const Duration(seconds: 3),
      ),
    );
  }

  String _formatElapsed(String timestampStr) {
    try {
      final orderTime = DateTime.parse(timestampStr).toLocal();
      final diff = _now.difference(orderTime);
      if (diff.inMinutes < 1) return 'Just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      final hours = diff.inHours;
      final remMins = diff.inMinutes % 60;
      return '${hours}h ${remMins}m ago';
    } catch (_) {
      return '';
    }
  }

  Color _getElapsedColor(String timestampStr) {
    try {
      final orderTime = DateTime.parse(timestampStr).toLocal();
      final diff = _now.difference(orderTime);
      if (diff.inMinutes >= 15) return const Color(0xFFB3261E);
      if (diff.inMinutes >= 8) return const Color(0xFFB45309);
      return MenuTheme.pinkInk;
    } catch (_) {
      return MenuTheme.pinkInk;
    }
  }

  List<dynamic> _filterOrders(List<dynamic> list) {
    var res = list;
    if (_typeFilter != 'ALL') {
      res = res.where((o) {
        final type = (o['type'] as String? ?? '').toLowerCase();
        if (_typeFilter == 'Delivery') return type.contains('delivery');
        if (_typeFilter == 'Pickup') return type.contains('pickup');
        if (_typeFilter == 'Walk-In') {
          final entryType = (o['entryType'] as String? ?? '').toLowerCase();
          return type.contains('walk-in') || entryType.contains('staff');
        }
        return true;
      }).toList();
    }
    if (_searchQuery.trim().isNotEmpty) {
      final q = _searchQuery.trim().toLowerCase();
      res = res.where((o) {
        final num = (o['orderNumber'] as String? ?? '').toLowerCase();
        final name = (o['customerName'] as String? ?? '').toLowerCase();
        final phone = (o['customerPhone'] as String? ?? '').toLowerCase();
        final addr = (o['customerAddress'] as String? ?? '').toLowerCase();
        final items = (o['items'] as List<dynamic>? ?? [])
            .map((i) => (i['name'] as String? ?? '').toLowerCase())
            .join(' ');
        return num.contains(q) ||
            name.contains(q) ||
            phone.contains(q) ||
            addr.contains(q) ||
            items.contains(q);
      }).toList();
    }
    return res;
  }

  void _copyRiderDispatchNote(dynamic order) {
    final orderNum = order['orderNumber'] ?? order['id'];
    final name = order['customerName'] ?? 'Customer';
    final phone = (order['customerPhone'] as String?)?.trim() ?? '';
    final addr = (order['customerAddress'] as String?)?.trim() ?? '';
    final lat = order['lat'];
    final lng = order['lng'];
    final total = order['total'] ?? 0;
    final paymentMethod = order['paymentMethod'] ?? 'Cash';
    final isPaid =
        (order['paymentStatus'] as String? ?? '').toUpperCase() == 'PAID';
    final items = (order['items'] as List<dynamic>? ?? [])
        .map(
          (i) =>
              '  • ${(i['quantity'] ?? i['qty'] ?? 1)}x ${i['name']}${i['variant'] != null && (i['variant'] as String).isNotEmpty ? ' (${i['variant']})' : ''}',
        )
        .join('\n');

    final mapsLink = (lat != null && lng != null)
        ? 'https://www.google.com/maps/dir/?api=1&destination=$lat,$lng'
        : '';

    final note = [
      '🛵 *LUNA BITES & DELIGHTS — #$orderNum*',
      '👤 Customer: $name',
      if (phone.isNotEmpty) '📞 Phone: $phone',
      if (addr.isNotEmpty) '📍 Address: $addr',
      if (mapsLink.isNotEmpty) '🗺 Navigation: $mapsLink',
      '',
      '🛒 *Items:*',
      items,
      '',
      '💰 Food Total: ₱$total (${isPaid ? 'PAID ($paymentMethod)' : 'COLLECT ₱$total'})',
      '🚚 Delivery fee: Confirmed by rider upon delivery',
    ].join('\n');

    Clipboard.setData(ClipboardData(text: note));
    _snack(
      'Delivery dispatch note copied to clipboard',
      const Color(0xFF1E7A3C),
    );
  }

  void _showPrintTicketDialog(dynamic order) {
    final orderNum = order['orderNumber'] ?? order['id'];
    final name = order['customerName'] ?? 'Customer';
    final phone = (order['customerPhone'] as String?)?.trim() ?? '';
    final addr = (order['customerAddress'] as String?)?.trim() ?? '';
    final type = (order['type'] as String? ?? 'Walk-In').toUpperCase();
    final total = order['total'] ?? 0;
    final paymentStatus = (order['paymentStatus'] as String? ?? 'NOT PAID')
        .toUpperCase();
    final paymentMethod = order['paymentMethod'] ?? 'Cash';
    final items = order['items'] as List<dynamic>? ?? [];

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: MenuTheme.card,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: MenuTheme.rule, width: 1.5),
        ),
        title: Row(
          children: [
            const Icon(Icons.receipt_long_rounded, color: MenuTheme.pinkInk),
            const SizedBox(width: 10),
            Text('KITCHEN TICKET', style: MenuTheme.heading(20)),
          ],
        ),
        content: Container(
          width: 320,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: MenuTheme.paper,
            border: Border.all(color: MenuTheme.rule),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Column(
                  children: [
                    Text('LUNA BITES & DELIGHTS', style: MenuTheme.heading(18)),
                    Text(
                      'Purok 5, Magallanes · KITCHEN SLIP',
                      style: MenuTheme.body(size: 11, color: MenuTheme.inkSoft),
                    ),
                    const SizedBox(height: 8),
                    Text('#$orderNum', style: MenuTheme.heading(28)),
                    Text(
                      type,
                      style: MenuTheme.body(
                        size: 12,
                        color: MenuTheme.pinkInk,
                      ).copyWith(fontWeight: FontWeight.w800, letterSpacing: 1),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              const Text(
                '--------------------------------',
                textAlign: TextAlign.center,
                style: TextStyle(color: MenuTheme.rule),
              ),
              Text(
                'Customer: $name',
                style: MenuTheme.body(
                  size: 13,
                  color: MenuTheme.ink,
                ).copyWith(fontWeight: FontWeight.w700),
              ),
              if (phone.isNotEmpty)
                Text(
                  'Phone: $phone',
                  style: MenuTheme.body(size: 12, color: MenuTheme.pinkInk),
                ),
              if (addr.isNotEmpty)
                Text(
                  'Address: $addr',
                  style: MenuTheme.body(size: 12, color: MenuTheme.inkSoft),
                ),
              const Text(
                '--------------------------------',
                textAlign: TextAlign.center,
                style: TextStyle(color: MenuTheme.rule),
              ),
              const SizedBox(height: 6),
              ...items.map(
                (i) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${i['quantity'] ?? i['qty'] ?? 1}x ',
                        style: MenuTheme.heading(
                          16,
                        ).copyWith(color: MenuTheme.ink),
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              i['name'] ?? '',
                              style: MenuTheme.body(
                                size: 13,
                                color: MenuTheme.ink,
                              ).copyWith(fontWeight: FontWeight.w700),
                            ),
                            if (i['variant'] != null &&
                                (i['variant'] as String).isNotEmpty)
                              Text(
                                i['variant'],
                                style: MenuTheme.body(
                                  size: 11,
                                  color: MenuTheme.inkSoft,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 6),
              const Text(
                '--------------------------------',
                textAlign: TextAlign.center,
                style: TextStyle(color: MenuTheme.rule),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('TOTAL:', style: MenuTheme.heading(18)),
                  Text(
                    '₱$total ($paymentStatus)',
                    style: MenuTheme.heading(
                      18,
                    ).copyWith(color: MenuTheme.pinkInk),
                  ),
                ],
              ),
              Text(
                'Payment: $paymentMethod',
                style: MenuTheme.body(size: 11, color: MenuTheme.inkSoft),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(
              'CLOSE',
              style: MenuTheme.body(size: 12, color: MenuTheme.inkSoft),
            ),
          ),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: MenuTheme.plate,
              foregroundColor: MenuTheme.onPlate,
              shape: const RoundedRectangleBorder(),
            ),
            onPressed: () {
              Navigator.pop(ctx);
              openUrlInBrowser('javascript:window.print()');
              _snack('Print dialog opened', const Color(0xFF1E7A3C));
            },
            icon: const Icon(Icons.print_rounded, size: 16),
            label: Text(
              'PRINT SLIP',
              style: MenuTheme.body(
                size: 12,
                color: MenuTheme.onPlate,
              ).copyWith(fontWeight: FontWeight.w800, letterSpacing: 1),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sessionWatcher = context.watch<Session>();

    // If staff is not logged in, prompt authentication immediately
    if (!sessionWatcher.isStaff) {
      return _buildStaffAuthGate();
    }

    final isMobile = MediaQuery.of(context).size.width < 960;
    final filtered = _filterOrders(_orders);

    final pending = filtered.where((o) => o['status'] == 'Pending').toList();
    final preparing = filtered
        .where((o) => o['status'] == 'Preparing')
        .toList();
    final ready = filtered.where((o) => o['status'] == 'Ready').toList();
    final completed = filtered
        .where((o) => o['status'] == 'Completed' || o['status'] == 'Cancelled')
        .toList();

    return Scaffold(
      backgroundColor: MenuTheme.ground,
      appBar: _buildAppBar(
        context,
        pending.length,
        preparing.length,
        ready.length,
      ),
      body: SafeArea(
        child: Column(
          children: [
            _buildControlBar(pending.length, preparing.length, ready.length),
            if (_error != null) _buildErrorBanner(),
            Expanded(
              child: isMobile
                  ? _buildMobileTabViews(pending, preparing, ready, completed)
                  : _buildDesktopKanbanBoard(pending, preparing, ready),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStaffAuthGate() {
    return const Scaffold(
      backgroundColor: MenuTheme.ground,
      body: Center(
        child: SingleChildScrollView(
          padding: EdgeInsets.symmetric(vertical: 24),
          child: StaffLoginDialog(),
        ),
      ),
    );
  }

  PreferredSizeWidget _buildAppBar(
    BuildContext context,
    int pendingCount,
    int prepCount,
    int readyCount,
  ) {
    final sessionWatcher = context.watch<Session>();
    return AppBar(
      backgroundColor: MenuTheme.paper,
      foregroundColor: MenuTheme.ink,
      elevation: 0,
      titleSpacing: 16,
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(2),
        child: Container(color: MenuTheme.pinkInk, height: 2),
      ),
      title: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: MenuTheme.card,
              border: Border.all(color: MenuTheme.rule),
            ),
            child: Center(
              child: Image.asset(
                'images/luna_logo.png',
                height: 28,
                excludeFromSemantics: true,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'LUNA LIVE OPERATIONS',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: MenuTheme.heading(20).copyWith(letterSpacing: 1.5),
                ),
                Row(
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      color: const Color(0xFF1E7A3C),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'Purok 5 Kiosk · Sync in ${_secondsUntilSync}s',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: MenuTheme.body(
                          size: 11,
                          color: MenuTheme.inkSoft,
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: sessionWatcher.isAdmin
                            ? MenuTheme.plate
                            : MenuTheme.card,
                        border: Border.all(
                          color: sessionWatcher.isAdmin
                              ? MenuTheme.pinkInk
                              : MenuTheme.rule,
                        ),
                      ),
                      child: Text(
                        sessionWatcher.isAdmin ? 'ADMIN' : 'STAFF',
                        style:
                            MenuTheme.body(
                              size: 9,
                              color: sessionWatcher.isAdmin
                                  ? MenuTheme.onPlate
                                  : MenuTheme.ink,
                            ).copyWith(
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.5,
                            ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
      actions: [
        // Sound Chime Toggle & Test
        IconButton(
          tooltip: AudioAlertService.soundEnabled
              ? 'Audio Alerts: ON (Tap to Mute)'
              : 'Audio Alerts: MUTED (Tap to Enable)',
          icon: Icon(
            AudioAlertService.soundEnabled
                ? Icons.volume_up_rounded
                : Icons.volume_off_rounded,
            color: AudioAlertService.soundEnabled
                ? MenuTheme.pinkInk
                : MenuTheme.inkSoft,
            size: 20,
          ),
          onPressed: () {
            setState(() {
              AudioAlertService.soundEnabled = !AudioAlertService.soundEnabled;
            });
            if (AudioAlertService.soundEnabled) {
              AudioAlertService.playOrderChime();
              _snack(
                'Audio Alert Enabled (Chime tested)',
                const Color(0xFF1E7A3C),
              );
            } else {
              _snack('Audio Alert Muted', MenuTheme.inkSoft);
            }
          },
        ),

        // Manual Refresh
        IconButton(
          tooltip: 'Sync Orders Now',
          icon: _loading
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: MenuTheme.pinkInk,
                  ),
                )
              : const Icon(
                  Icons.sync_rounded,
                  color: MenuTheme.pinkInk,
                  size: 20,
                ),
          onPressed: _loading
              ? null
              : () {
                  _secondsUntilSync = 10;
                  _fetchActiveOrders();
                },
        ),

        const SizedBox(width: 4),

        // Walk-in Order Button (Square Vermilion Plate)
        InkWell(
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const KioskMenuPage()),
            );
          },
          child: Container(
            margin: const EdgeInsets.symmetric(vertical: 10),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: MenuTheme.plate,
              border: Border.all(
                color: MenuTheme.pinkInk.withValues(alpha: 0.4),
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.point_of_sale_outlined,
                  color: MenuTheme.onPlate,
                  size: 15,
                ),
                const SizedBox(width: 6),
                Text(
                  'POS WALK-IN',
                  style: MenuTheme.body(
                    size: 11,
                    color: MenuTheme.onPlate,
                  ).copyWith(fontWeight: FontWeight.w800, letterSpacing: 1),
                ),
              ],
            ),
          ),
        ),

        const SizedBox(width: 4),

        // Admin Dashboard Link
        IconButton(
          tooltip: 'Sales Analytics & Admin',
          icon: const Icon(
            Icons.bar_chart_outlined,
            color: MenuTheme.pinkInk,
            size: 20,
          ),
          onPressed: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const AdminDashboard()),
            );
          },
        ),

        // Logout
        IconButton(
          tooltip: 'Exit Staff Portal',
          icon: const Icon(
            Icons.logout_rounded,
            color: Color(0xFFB3261E),
            size: 19,
          ),
          onPressed: () {
            session.logout();
            Navigator.pushNamedAndRemoveUntil(context, '/', (route) => false);
          },
        ),
        const SizedBox(width: 8),
      ],
    );
  }

  Widget _buildControlBar(int pendingCount, int prepCount, int readyCount) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      decoration: const BoxDecoration(
        color: MenuTheme.paper,
        border: Border(bottom: BorderSide(color: MenuTheme.rule)),
      ),
      child: Row(
        children: [
          // Filter Chips (Square Painted Plates)
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _buildFilterChip('ALL'),
                  const SizedBox(width: 8),
                  _buildFilterChip('Delivery', icon: Icons.motorcycle_outlined),
                  const SizedBox(width: 8),
                  _buildFilterChip('Pickup', icon: Icons.storefront_outlined),
                  const SizedBox(width: 8),
                  _buildFilterChip(
                    'Walk-In',
                    icon: Icons.shopping_bag_outlined,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 12),

          // Search Box (Square Painted)
          Container(
            width: 170,
            height: 32,
            decoration: BoxDecoration(
              color: MenuTheme.card,
              border: Border.all(color: MenuTheme.rule),
            ),
            child: TextField(
              controller: _searchCtrl,
              onChanged: (v) => setState(() => _searchQuery = v),
              style: MenuTheme.body(size: 12),
              decoration: InputDecoration(
                hintText: 'Search orders...',
                hintStyle: MenuTheme.body(size: 11, color: MenuTheme.inkSoft),
                prefixIcon: const Icon(
                  Icons.search_rounded,
                  size: 15,
                  color: MenuTheme.inkSoft,
                ),
                suffixIcon: _searchQuery.isNotEmpty
                    ? GestureDetector(
                        onTap: () {
                          _searchCtrl.clear();
                          setState(() => _searchQuery = '');
                        },
                        child: const Icon(
                          Icons.clear_rounded,
                          size: 14,
                          color: MenuTheme.inkSoft,
                        ),
                      )
                    : null,
                border: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(vertical: 8),
              ),
            ),
          ),
          const SizedBox(width: 10),

          // History toggle
          InkWell(
            onTap: () {
              setState(() {
                _showCompleted = !_showCompleted;
              });
              _fetchActiveOrders();
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: _showCompleted ? MenuTheme.card : MenuTheme.paper,
                border: Border.all(
                  color: _showCompleted ? MenuTheme.pinkInk : MenuTheme.rule,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    _showCompleted
                        ? Icons.check_box_outlined
                        : Icons.check_box_outline_blank_outlined,
                    size: 15,
                    color: _showCompleted
                        ? MenuTheme.pinkInk
                        : MenuTheme.inkSoft,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'HISTORY',
                    style: MenuTheme.body(
                      size: 11,
                      color: _showCompleted ? MenuTheme.ink : MenuTheme.inkSoft,
                    ).copyWith(fontWeight: FontWeight.w700, letterSpacing: 1),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label, {IconData? icon}) {
    final isSelected = _typeFilter == label;
    return InkWell(
      onTap: () => setState(() => _typeFilter = label),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? MenuTheme.plate : MenuTheme.card,
          border: Border.all(
            color: isSelected ? MenuTheme.pinkInk : MenuTheme.rule,
          ),
        ),
        child: Row(
          children: [
            if (icon != null) ...[
              Icon(
                icon,
                size: 14,
                color: isSelected ? MenuTheme.onPlate : MenuTheme.pinkInk,
              ),
              const SizedBox(width: 6),
            ],
            Text(
              label.toUpperCase(),
              style: MenuTheme.body(
                size: 11,
                color: isSelected ? MenuTheme.onPlate : MenuTheme.pinkInk,
              ).copyWith(fontWeight: FontWeight.w800, letterSpacing: 1),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorBanner() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFFCE4E4),
        border: const Border(bottom: BorderSide(color: Color(0xFFB3261E))),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.warning_amber_rounded,
            color: Color(0xFFB3261E),
            size: 18,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _error!,
              style: MenuTheme.body(
                size: 12,
                color: MenuTheme.ink,
              ).copyWith(fontWeight: FontWeight.w600),
            ),
          ),
          TextButton(
            onPressed: () => _fetchActiveOrders(),
            child: Text(
              'RETRY',
              style: MenuTheme.body(
                size: 12,
                color: MenuTheme.ink,
              ).copyWith(fontWeight: FontWeight.w800, letterSpacing: 1),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDesktopKanbanBoard(
    List<dynamic> pending,
    List<dynamic> preparing,
    List<dynamic> ready,
  ) {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 1. Pending Queue
          Expanded(
            child: _buildColumnContainer(
              title: '1. PENDING QUEUE',
              orders: pending,
              columnStatus: 'Pending',
              headerBg: MenuTheme.plate,
              titleColor: MenuTheme.onPlate,
              icon: Icons.hourglass_top_outlined,
            ),
          ),
          const SizedBox(width: 16),

          // 2. Preparing Now
          Expanded(
            child: _buildColumnContainer(
              title: '2. PREPARING NOW',
              orders: preparing,
              columnStatus: 'Preparing',
              headerBg: MenuTheme.card,
              titleColor: MenuTheme.pinkInk,
              icon: Icons.outdoor_grill_outlined,
            ),
          ),
          const SizedBox(width: 16),

          // 3. Ready For Pickup / Rider
          Expanded(
            child: _buildColumnContainer(
              title: '3. READY FOR PICKUP / RIDER',
              orders: ready,
              columnStatus: 'Ready',
              headerBg: const Color(0xFFE3F3E6),
              titleColor: const Color(0xFF1E6B35),
              icon: Icons.done_all_rounded,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMobileTabViews(
    List<dynamic> pending,
    List<dynamic> preparing,
    List<dynamic> ready,
    List<dynamic> completed,
  ) {
    return Column(
      children: [
        Container(
          color: MenuTheme.paper,
          child: TabBar(
            controller: _tabController,
            labelColor: MenuTheme.ink,
            unselectedLabelColor: MenuTheme.inkSoft,
            indicatorColor: MenuTheme.plate,
            indicatorWeight: 3,
            labelStyle: MenuTheme.body(
              size: 12,
            ).copyWith(fontWeight: FontWeight.w800, letterSpacing: 1),
            tabs: [
              Tab(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('PENDING'),
                    const SizedBox(width: 6),
                    _buildCountBadge(pending.length, MenuTheme.plate),
                  ],
                ),
              ),
              Tab(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('COOKING'),
                    const SizedBox(width: 6),
                    _buildCountBadge(preparing.length, MenuTheme.card),
                  ],
                ),
              ),
              Tab(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('READY'),
                    const SizedBox(width: 6),
                    _buildCountBadge(ready.length, const Color(0xFF1E7A3C)),
                  ],
                ),
              ),
              Tab(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('DONE'),
                    const SizedBox(width: 6),
                    _buildCountBadge(completed.length, MenuTheme.rule),
                  ],
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              _buildOrdersList(pending, 'Pending'),
              _buildOrdersList(preparing, 'Preparing'),
              _buildOrdersList(ready, 'Ready'),
              _buildOrdersList(completed, 'Completed'),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildCountBadge(int count, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color,
        border: Border.all(color: MenuTheme.rule),
      ),
      child: Text(
        '$count',
        style: MenuTheme.heading(12).copyWith(
          color: color == MenuTheme.plate || color == const Color(0xFF1E7A3C)
              ? MenuTheme.onPlate
              : MenuTheme.ink,
        ),
      ),
    );
  }

  Widget _buildColumnContainer({
    required String title,
    required List<dynamic> orders,
    required String columnStatus,
    required Color headerBg,
    required Color titleColor,
    required IconData icon,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: MenuTheme.paper,
        border: Border.all(color: MenuTheme.rule, width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Column Header (Square Painted Plate)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: headerBg,
              border: const Border(bottom: BorderSide(color: MenuTheme.rule)),
            ),
            child: Row(
              children: [
                Icon(icon, color: titleColor, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    title,
                    style: MenuTheme.heading(
                      18,
                    ).copyWith(letterSpacing: 1.5, color: titleColor),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: MenuTheme.paper,
                    border: Border.all(color: MenuTheme.rule),
                  ),
                  child: Text(
                    '${orders.length}',
                    style: MenuTheme.heading(16).copyWith(color: MenuTheme.ink),
                  ),
                ),
              ],
            ),
          ),
          // Scrollable Orders List
          Expanded(child: _buildOrdersList(orders, columnStatus)),
        ],
      ),
    );
  }

  Widget _buildOrdersList(List<dynamic> orders, String columnStatus) {
    if (orders.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                columnStatus == 'Pending'
                    ? Icons.hourglass_empty_outlined
                    : columnStatus == 'Preparing'
                    ? Icons.outdoor_grill_outlined
                    : Icons.check_circle_outline_rounded,
                color: MenuTheme.inkSoft.withValues(alpha: 0.5),
                size: 40,
              ),
              const SizedBox(height: 12),
              Text(
                columnStatus == 'Pending'
                    ? 'No orders in queue.'
                    : columnStatus == 'Preparing'
                    ? 'Grill & fryer are clear.'
                    : 'No orders ready for pickup.',
                textAlign: TextAlign.center,
                style: MenuTheme.body(size: 13, color: MenuTheme.inkSoft),
              ),
            ],
          ),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: orders.length,
      itemBuilder: (context, index) => _buildOrderCard(orders[index]),
    );
  }

  Widget _buildOrderCard(dynamic order) {
    final orderId = order['id'] as String;
    final orderNum = order['orderNumber'] as String? ?? orderId;
    final customerName =
        (order['customerName'] as String?)?.trim() ?? 'Customer';
    final customerPhone = (order['customerPhone'] as String?)?.trim() ?? '';
    final customerAddress = (order['customerAddress'] as String?)?.trim() ?? '';
    final lat = order['lat'] as double?;
    final lng = order['lng'] as double?;
    final type = order['type'] as String? ?? 'Walk-In';
    final paymentStatus = (order['paymentStatus'] as String? ?? 'NOT PAID')
        .toUpperCase();
    final paymentMethod = order['paymentMethod'] as String? ?? 'Cash';
    final status = order['status'] as String? ?? 'Pending';
    final timestampStr = order['timestamp'] as String? ?? '';
    final items = order['items'] as List<dynamic>? ?? [];
    final total = order['total'] ?? 0;

    final isDelivery = type.toLowerCase().contains('delivery');
    final isPickup = type.toLowerCase().contains('pickup');

    final elapsedText = _formatElapsed(timestampStr);
    final elapsedColor = _getElapsedColor(timestampStr);

    final isPaid = paymentStatus == 'PAID';
    final isDelayed =
        status == 'Pending' &&
        _now.difference(DateTime.tryParse(timestampStr) ?? _now).inMinutes >=
            10;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: MenuTheme.card,
        border: Border.all(
          color: isDelayed ? const Color(0xFFB3261E) : MenuTheme.rule,
          width: isDelayed ? 2.0 : 1.0,
        ),
        boxShadow: const [
          BoxShadow(color: Colors.black45, blurRadius: 8, offset: Offset(0, 3)),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top Row: Order # and Elapsed Time + Actions
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: MenuTheme.paper,
                        border: Border.all(color: MenuTheme.rule),
                      ),
                      child: Text(
                        '#$orderNum',
                        style: MenuTheme.heading(18).copyWith(letterSpacing: 1),
                      ),
                    ),
                    const SizedBox(width: 4),
                    IconButton(
                      tooltip: 'Kitchen Slip Ticket',
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(
                        minWidth: 26,
                        minHeight: 26,
                      ),
                      icon: const Icon(
                        Icons.receipt_long_outlined,
                        size: 16,
                        color: MenuTheme.pinkInk,
                      ),
                      onPressed: () => _showPrintTicketDialog(order),
                    ),
                    if (isDelivery)
                      IconButton(
                        tooltip: 'Copy Delivery Dispatch Note',
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(
                          minWidth: 26,
                          minHeight: 26,
                        ),
                        icon: const Icon(
                          Icons.copy_rounded,
                          size: 14,
                          color: MenuTheme.pinkInk,
                        ),
                        onPressed: () => _copyRiderDispatchNote(order),
                      ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: isDelayed
                        ? const Color(0xFFFCE4E4)
                        : MenuTheme.paper,
                    border: Border.all(
                      color: isDelayed
                          ? const Color(0xFFB3261E)
                          : MenuTheme.rule,
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        isDelayed
                            ? Icons.warning_amber_rounded
                            : Icons.access_time_rounded,
                        size: 12,
                        color: isDelayed ? MenuTheme.ink : elapsedColor,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        isDelayed ? 'DELAYED ($elapsedText)' : elapsedText,
                        style: MenuTheme.body(
                          size: 11,
                          color: isDelayed ? MenuTheme.ink : elapsedColor,
                        ).copyWith(fontWeight: FontWeight.w800),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),

            // Order Type & Payment Status Badge (Square Painted Plates)
            Row(
              children: [
                // Type Pill
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 7,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: isDelivery
                        ? const Color(0xFFFFF1C2)
                        : isPickup
                        ? const Color(0xFFE6F0FB)
                        : MenuTheme.paper,
                    border: Border.all(color: MenuTheme.rule),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        isDelivery
                            ? Icons.motorcycle_outlined
                            : isPickup
                            ? Icons.storefront_outlined
                            : Icons.shopping_bag_outlined,
                        size: 13,
                        color: MenuTheme.ink,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        type.toUpperCase(),
                        style: MenuTheme.body(size: 10, color: MenuTheme.ink)
                            .copyWith(
                              fontWeight: FontWeight.w800,
                              letterSpacing: 1,
                            ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),

                // Payment Status Pill
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 7,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: isPaid
                        ? const Color(0xFFE3F3E6)
                        : const Color(0xFFFCE4E4),
                    border: Border.all(
                      color: isPaid
                          ? const Color(0xFF1E7A3C)
                          : const Color(0xFFB3261E),
                    ),
                  ),
                  child: Text(
                    isPaid ? 'PAID ($paymentMethod)' : 'COLLECT ₱$total',
                    style: MenuTheme.body(
                      size: 10,
                      color: MenuTheme.ink,
                    ).copyWith(fontWeight: FontWeight.w800, letterSpacing: 0.5),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),

            // Customer Name & Phone
            Row(
              children: [
                Expanded(
                  child: Text(
                    customerName,
                    style: MenuTheme.body(
                      size: 15,
                      color: MenuTheme.ink,
                    ).copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                if (customerPhone.isNotEmpty)
                  InkWell(
                    onTap: () => openUrlInBrowser('tel:$customerPhone'),
                    child: Padding(
                      padding: const EdgeInsets.all(4.0),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.phone_outlined,
                            size: 13,
                            color: MenuTheme.pinkInk,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            customerPhone,
                            style: MenuTheme.body(
                              size: 12,
                              color: MenuTheme.pinkInk,
                            ).copyWith(fontWeight: FontWeight.w700),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),

            // Delivery Address & Maps Button (if Delivery)
            if (isDelivery && customerAddress.isNotEmpty) ...[
              const SizedBox(height: 6),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: MenuTheme.paper,
                  border: Border.all(color: MenuTheme.rule),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.place_outlined,
                      size: 14,
                      color: MenuTheme.pinkInk,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        customerAddress,
                        style: MenuTheme.body(size: 11, color: MenuTheme.ink),
                      ),
                    ),
                    if (lat != null && lng != null)
                      InkWell(
                        onTap: () => openUrlInBrowser(
                          'https://www.google.com/maps/dir/?api=1&destination=$lat,$lng',
                        ),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 3,
                          ),
                          decoration: const BoxDecoration(
                            color: MenuTheme.plate,
                          ),
                          child: Text(
                            'MAP',
                            style: MenuTheme.body(
                              size: 10,
                              color: MenuTheme.onPlate,
                            ).copyWith(fontWeight: FontWeight.w800),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 10),
            const Divider(height: 1, thickness: 1, color: MenuTheme.rule),
            const SizedBox(height: 8),

            // Item Checklist (Square Checkbox)
            ...items.asMap().entries.map((entry) {
              final idx = entry.key;
              final item = entry.value;
              final name = item['name'] as String? ?? 'Item';
              final qty = (item['quantity'] ?? item['qty'] ?? 1) as int;
              final variant = item['variant'] as String?;
              final itemKey = '${orderId}_$idx';
              final isChecked = _checkedItemKeys.contains(itemKey);

              return InkWell(
                onTap: () {
                  setState(() {
                    if (isChecked) {
                      _checkedItemKeys.remove(itemKey);
                    } else {
                      _checkedItemKeys.add(itemKey);
                    }
                  });
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 16,
                        height: 16,
                        margin: const EdgeInsets.only(top: 2),
                        decoration: BoxDecoration(
                          color: isChecked ? MenuTheme.plate : MenuTheme.paper,
                          border: Border.all(
                            color: isChecked
                                ? MenuTheme.pinkInk
                                : MenuTheme.rule,
                          ),
                        ),
                        child: isChecked
                            ? const Center(
                                child: Icon(
                                  Icons.check,
                                  size: 12,
                                  color: MenuTheme.onPlate,
                                ),
                              )
                            : null,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        '${qty}x',
                        style: MenuTheme.heading(15).copyWith(
                          color: isChecked ? MenuTheme.inkSoft : MenuTheme.ink,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              name,
                              style:
                                  MenuTheme.body(
                                    size: 13,
                                    color: isChecked
                                        ? MenuTheme.inkSoft
                                        : MenuTheme.ink,
                                  ).copyWith(
                                    fontWeight: FontWeight.w600,
                                    decoration: isChecked
                                        ? TextDecoration.lineThrough
                                        : null,
                                  ),
                            ),
                            if (variant != null && variant.isNotEmpty)
                              Text(
                                variant,
                                style: MenuTheme.body(
                                  size: 11,
                                  color: MenuTheme.inkSoft,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }),

            const SizedBox(height: 12),

            // Order Total and Cancel Action
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Text(
                      isDelivery ? 'FOOD TOTAL: ' : 'TOTAL: ',
                      style: MenuTheme.body(
                        size: 11,
                        color: MenuTheme.pinkInk,
                      ).copyWith(fontWeight: FontWeight.w700, letterSpacing: 1),
                    ),
                    Text(
                      '₱$total',
                      style: MenuTheme.heading(
                        20,
                      ).copyWith(color: MenuTheme.ink),
                    ),
                  ],
                ),
                if (status == 'Pending')
                  TextButton(
                    onPressed: () => _confirmCancelOrder(orderId, orderNum),
                    child: Text(
                      'Cancel',
                      style: MenuTheme.body(
                        size: 11,
                        color: const Color(0xFFB3261E),
                      ).copyWith(fontWeight: FontWeight.w700),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),

            // Primary Flow Status Button (Square Painted Plate)
            _buildStatusActionButton(orderId, status),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusActionButton(String orderId, String currentStatus) {
    String label = '';
    String nextStatus = '';
    Color buttonColor = MenuTheme.plate;
    IconData icon = Icons.arrow_forward_rounded;

    if (currentStatus == 'Pending') {
      label = 'START PREPARING';
      nextStatus = 'Preparing';
      buttonColor = MenuTheme.plate; // Pink plate
      icon = Icons.outdoor_grill_outlined;
    } else if (currentStatus == 'Preparing') {
      label = 'MARK AS READY';
      nextStatus = 'Ready';
      buttonColor = const Color(0xFF1E7A3C); // Green plate
      icon = Icons.done_all_rounded;
    } else if (currentStatus == 'Ready') {
      label = 'COMPLETE & DISPATCH';
      nextStatus = 'Completed';
      buttonColor = MenuTheme.paper;
      icon = Icons.task_alt_rounded;
    } else {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 8),
        alignment: Alignment.center,
        child: Text(
          'ORDER $currentStatus',
          style: MenuTheme.body(
            size: 11,
            color: MenuTheme.inkSoft,
          ).copyWith(fontWeight: FontWeight.w800, letterSpacing: 1),
        ),
      );
    }

    return InkWell(
      onTap: () => _updateStatus(orderId, nextStatus),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: buttonColor,
          border: Border.all(color: MenuTheme.pinkInk.withValues(alpha: 0.4)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              color: buttonColor == MenuTheme.paper
                  ? MenuTheme.ink
                  : MenuTheme.onPlate,
              size: 16,
            ),
            const SizedBox(width: 8),
            Text(
              label,
              style: MenuTheme.body(
                size: 12,
                color: buttonColor == MenuTheme.paper
                    ? MenuTheme.ink
                    : MenuTheme.onPlate,
              ).copyWith(fontWeight: FontWeight.w800, letterSpacing: 1.5),
            ),
          ],
        ),
      ),
    );
  }

  void _confirmCancelOrder(String orderId, String orderNum) {
    String selectedReason = 'Item Out of Stock';
    final reasons = [
      'Item Out of Stock',
      'Customer Requested Cancellation',
      'Duplicate / Test Order',
      'Store Closing / Capacity',
    ];

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: MenuTheme.card,
          shape: RoundedRectangleBorder(
            side: BorderSide(color: MenuTheme.rule, width: 1.5),
          ),
          title: Text('CANCEL ORDER #$orderNum?', style: MenuTheme.heading(20)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Select cancellation reason:',
                style: MenuTheme.body(size: 13, color: MenuTheme.inkSoft),
              ),
              const SizedBox(height: 10),
              ...reasons.map(
                (r) => InkWell(
                  onTap: () => setDialogState(() => selectedReason = r),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(
                      children: [
                        Container(
                          width: 16,
                          height: 16,
                          decoration: BoxDecoration(
                            color: selectedReason == r
                                ? MenuTheme.plate
                                : MenuTheme.paper,
                            border: Border.all(
                              color: selectedReason == r
                                  ? MenuTheme.pinkInk
                                  : MenuTheme.rule,
                            ),
                          ),
                          child: selectedReason == r
                              ? const Center(
                                  child: Icon(
                                    Icons.square,
                                    size: 8,
                                    color: MenuTheme.onPlate,
                                  ),
                                )
                              : null,
                        ),
                        const SizedBox(width: 10),
                        Text(
                          r,
                          style: MenuTheme.body(
                            size: 13,
                            color: selectedReason == r
                                ? MenuTheme.ink
                                : MenuTheme.pinkInk,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(
                'BACK',
                style: MenuTheme.body(size: 12, color: MenuTheme.inkSoft),
              ),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFB3261E),
                shape: const RoundedRectangleBorder(),
              ),
              onPressed: () {
                Navigator.pop(ctx);
                _updateStatus(orderId, 'Cancelled');
              },
              child: Text(
                'CONFIRM CANCEL',
                style: MenuTheme.body(
                  size: 12,
                  color: MenuTheme.onPlate,
                ).copyWith(fontWeight: FontWeight.w800, letterSpacing: 1),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
