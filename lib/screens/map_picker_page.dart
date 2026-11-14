import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../services/geocoding.dart';
import '../services/location.dart';
import '../widgets/kiosk/kiosk_theme.dart';

class MapPickerPage extends StatefulWidget {
  final String initialAddress;
  final double initialLat;
  final double initialLng;
  const MapPickerPage({
    super.key,
    required this.initialAddress,
    required this.initialLat,
    required this.initialLng,
  });

  @override
  State<MapPickerPage> createState() => _MapPickerPageState();
}

class _MapPickerPageState extends State<MapPickerPage>
    with TickerProviderStateMixin {
  late MapController _mapController;
  String _address = '';
  String _addressShort = '';
  bool _loading = false;
  double _lat = 0, _lng = 0;

  late AnimationController _pulseCtrl;

  final TextEditingController _searchCtrl = TextEditingController();
  final FocusNode _searchFocus = FocusNode();
  List<Map<String, dynamic>> _searchResults = [];
  bool _searching = false;
  Timer? _searchDebounce;
  Timer? _addressDebounce;
  bool _showResults = false;

  @override
  void initState() {
    super.initState();
    _address = widget.initialAddress;
    _addressShort = widget.initialAddress;
    _lat = widget.initialLat;
    _lng = widget.initialLng;
    _mapController = MapController();

    _pulseCtrl = AnimationController(
      duration: const Duration(milliseconds: 1600),
      vsync: this,
    )..repeat(reverse: true);

    _initLocation();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _pulseCtrl.stop();
      _pulseCtrl.value = 0.5;
    }
  }

  Future<void> _initLocation() async {
    final pos = await currentPosition();
    if (pos != null && mounted) {
      setState(() {
        _lat = pos.latitude;
        _lng = pos.longitude;
      });
    }
    if (!mounted) return;
    setState(() => _loading = false);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _mapController.move(LatLng(_lat, _lng), 17);
      _fetchAddress(_lat, _lng);
    });
  }

  Future<void> _goToMyLocation() async {
    final pos = await currentPosition();
    if (pos == null || !mounted) return;
    setState(() {
      _lat = pos.latitude;
      _lng = pos.longitude;
    });
    _mapController.move(LatLng(pos.latitude, pos.longitude), 17);
    await _fetchAddress(pos.latitude, pos.longitude);
  }

  Future<void> _fetchAddress(double lat, double lng) async {
    final addr = await reverseGeocode(lat, lng);
    if (!mounted) return;
    setState(() {
      if (addr.full.isNotEmpty) _address = addr.full;
      if (addr.short.isNotEmpty) {
        _addressShort = addr.short;
      } else if (_address.isEmpty) {
        _address = '${lat.toStringAsFixed(6)}, ${lng.toStringAsFixed(6)}';
        _addressShort = _address;
      }
    });
  }

  void _onSearchChanged(String query) {
    _searchDebounce?.cancel();
    if (query.trim().length < 2) {
      setState(() {
        _showResults = false;
        _searchResults.clear();
        _searching = false;
      });
      return;
    }
    setState(() => _searching = true);
    _searchDebounce = Timer(const Duration(milliseconds: 400), () async {
      final results = await searchAddress(query.trim());
      if (!mounted) return;
      setState(() {
        _searchResults = results;
        _showResults = results.isNotEmpty;
        _searching = false;
      });
    });
  }

  void _selectSearchResult(Map<String, dynamic> result) {
    final lat = double.tryParse(result['lat'].toString()) ?? _lat;
    final lng = double.tryParse(result['lon'].toString()) ?? _lng;
    final displayName = result['display_name'] as String? ?? '';

    setState(() {
      _lat = lat;
      _lng = lng;
      _address = displayName;
      _addressShort = shortAddress(result['address'] as Map<String, dynamic>?);
      _showResults = false;
      _searchCtrl.clear();
      _searchFocus.unfocus();
    });

    _mapController.move(LatLng(lat, lng), 17);
  }

  void _clearSearch() {
    _searchCtrl.clear();
    _searchDebounce?.cancel();
    setState(() {
      _showResults = false;
      _searchResults.clear();
      _searching = false;
    });
  }

  Future<void> _confirmLocation() async {
    setState(() => _loading = true);
    final center = _mapController.camera.center;
    setState(() {
      _lat = center.latitude;
      _lng = center.longitude;
    });
    await _fetchAddress(_lat, _lng);
    if (!mounted) return;
    setState(() => _loading = false);
    Navigator.pop(context, {'address': _address, 'lat': _lat, 'lng': _lng});
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    _searchCtrl.dispose();
    _searchFocus.dispose();
    _searchDebounce?.cancel();
    _addressDebounce?.cancel();
    _mapController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    return Scaffold(
      backgroundColor: KioskTheme.lunaBlushPaper,
      appBar: AppBar(
        title: Text(
          'PIN YOUR LOCATION',
          style: KioskTheme.headerSmall.copyWith(
            color: KioskTheme.textOnPrimary,
            letterSpacing: 1,
            fontSize: 18,
          ),
        ),
        backgroundColor: KioskTheme.lunaPink,
        foregroundColor: KioskTheme.textOnPrimary,
        elevation: 0,
        actions: [
          TextButton(
            style: TextButton.styleFrom(
              minimumSize: const Size(48, 44),
              foregroundColor: KioskTheme.textOnPrimary,
            ),
            onPressed: _address.isEmpty || _loading ? null : _confirmLocation,
            child: Text(
              'CONFIRM',
              style: KioskTheme.labelLarge.copyWith(
                color: KioskTheme.textOnPrimary,
                fontSize: 14,
              ),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          _buildSearchBar(),
          if (_showResults && _searchResults.isNotEmpty) _buildSearchResults(),
          Expanded(child: _buildMapContent(bottomInset)),
        ],
      ),
    );
  }

  Widget _buildSearchBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: KioskTheme.lunaWhite,
        boxShadow: [
          BoxShadow(
            color: KioskTheme.lunaPink.withValues(alpha: 0.05),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: TextField(
        controller: _searchCtrl,
        focusNode: _searchFocus,
        textInputAction: TextInputAction.search,
        onChanged: _onSearchChanged,
        onSubmitted: _onSearchChanged,
        onTap: () {
          if (_searchResults.isNotEmpty) {
            setState(() => _showResults = true);
          }
        },
        decoration: InputDecoration(
          hintText: 'Search address...',
          hintStyle: KioskTheme.bodyMedium.copyWith(
            color: KioskTheme.textMuted,
          ),
          prefixIcon: const Icon(
            Icons.search,
            color: KioskTheme.pinkInk,
            size: 20,
          ),
          suffixIcon: _searching
              ? const Padding(
                  padding: EdgeInsets.all(12),
                  child: SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator.adaptive(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(
                        KioskTheme.pinkInk,
                      ),
                    ),
                  ),
                )
              : _searchCtrl.text.isNotEmpty
              ? IconButton(
                  tooltip: 'Clear search',
                  icon: const Icon(Icons.clear, size: 18),
                  color: KioskTheme.textMuted,
                  onPressed: _clearSearch,
                )
              : null,
          filled: true,
          fillColor: KioskTheme.lunaBlushPaper,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 14,
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
            borderSide: BorderSide.none,
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
            borderSide: const BorderSide(
              color: KioskTheme.lunaPink,
              width: 1.5,
            ),
          ),
        ),
        style: KioskTheme.bodyMedium,
      ),
    );
  }

  Widget _buildSearchResults() {
    return Container(
      constraints: const BoxConstraints(maxHeight: 220),
      decoration: BoxDecoration(
        color: KioskTheme.lunaWhite,
        boxShadow: [
          BoxShadow(
            color: KioskTheme.pinkInk.withValues(alpha: 0.12),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: ListView.separated(
        shrinkWrap: true,
        padding: EdgeInsets.zero,
        itemCount: _searchResults.length,
        separatorBuilder: (_, _) => KioskTheme.divider(opacity: 0.1),
        itemBuilder: (context, index) {
          final r = _searchResults[index];
          final name = r['display_name'] as String? ?? '';
          return ListTile(
            dense: true,
            minVerticalPadding: 10,
            leading: const Icon(
              Icons.location_on,
              color: KioskTheme.pinkInk,
              size: 20,
            ),
            title: Text(
              name,
              style: KioskTheme.bodyMedium.copyWith(fontSize: 13),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            onTap: () => _selectSearchResult(r),
          );
        },
      ),
    );
  }

  Widget _buildMapContent(double bottomInset) {
    return Stack(
      children: [
        ColoredBox(
          color: KioskTheme.lunaBlushLight,
          child: FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: LatLng(_lat, _lng),
              initialZoom: 17,
              onMapEvent: (e) {
                if (e is MapEventMoveEnd) {
                  final c = _mapController.camera.center;
                  setState(() {
                    _lat = c.latitude;
                    _lng = c.longitude;
                  });
                  _addressDebounce?.cancel();
                  _addressDebounce = Timer(
                    const Duration(milliseconds: 600),
                    () => _fetchAddress(c.latitude, c.longitude),
                  );
                }
              },
            ),
            children: [
              if (tileUrl.isNotEmpty)
                TileLayer(
                  urlTemplate: tileUrl,
                  userAgentPackageName: 'com.lunabitesanddelights.app',
                  maxZoom: 19,
                ),
            ],
          ),
        ),
        _buildTilesNotice(),
        _buildPinOverlay(),
        Positioned(
          left: 16,
          right: 16,
          bottom: bottomInset + 16,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: _buildMyLocationButton(),
              ),
              const SizedBox(height: 12),
              _buildAddressCard(),
            ],
          ),
        ),
        if (_loading) _buildLoadingOverlay(),
      ],
    );
  }

  /// Explained once on screen: without a compiled-in key the picker still works
  /// through search and device location, it just has no basemap to drag around.
  Widget _buildTilesNotice() {
    if (tileUrl.isNotEmpty) return const SizedBox.shrink();
    return Positioned(
      top: 12,
      left: 16,
      right: 16,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: KioskTheme.lunaWhite,
          borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
          boxShadow: KioskTheme.shadowSm,
        ),
        child: Row(
          children: [
            const Icon(Icons.map_outlined, size: 18, color: KioskTheme.pinkInk),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Map preview is unavailable. Search your street or use your location.',
                style: KioskTheme.bodyMedium.copyWith(
                  fontSize: 12,
                  height: 1.3,
                  color: KioskTheme.textMuted,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPinOverlay() {
    return Positioned.fill(
      child: IgnorePointer(
        child: Align(
          alignment: Alignment.center,
          child: FractionalTranslation(
            translation: const Offset(0, -0.5),
            child: AnimatedBuilder(
              animation: _pulseCtrl,
              builder: (context, child) {
                return Transform.scale(
                  scale: 0.94 + (_pulseCtrl.value * 0.06),
                  child: child,
                );
              },
              child: Column(
                key: const Key('map_center_pin'),
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 36,
                    height: 44,
                    decoration: BoxDecoration(
                      color: KioskTheme.lunaPink,
                      borderRadius: const BorderRadius.only(
                        topLeft: Radius.circular(36),
                        topRight: Radius.circular(36),
                        bottomRight: Radius.circular(36),
                      ),
                      border: Border.all(color: Colors.white, width: 3),
                      boxShadow: KioskTheme.shadowMd,
                    ),
                    child: Center(
                      child: Container(
                        width: 12,
                        height: 12,
                        decoration: const BoxDecoration(
                          color: KioskTheme.lunaWhite,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Container(
                    width: 14,
                    height: 7,
                    decoration: BoxDecoration(
                      color: KioskTheme.lunaPink.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(7),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildMyLocationButton() {
    return Semantics(
      button: true,
      label: 'Use my current location',
      child: Material(
        color: KioskTheme.lunaWhite,
        shape: const CircleBorder(side: BorderSide(color: KioskTheme.rule)),
        elevation: 4,
        shadowColor: KioskTheme.pinkInk.withValues(alpha: 0.25),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: _goToMyLocation,
          child: const SizedBox(
            width: 48,
            height: 48,
            child: Icon(Icons.my_location, color: KioskTheme.pinkInk, size: 22),
          ),
        ),
      ),
    );
  }

  Widget _buildAddressCard() {
    final hasAddress = _addressShort.isNotEmpty;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(
        color: KioskTheme.lunaWhite,
        borderRadius: BorderRadius.circular(KioskTheme.radiusLg),
        border: Border.all(color: KioskTheme.rule),
        boxShadow: KioskTheme.shadowLg,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const Icon(
                Icons.location_on,
                color: KioskTheme.pinkInk,
                size: 18,
              ),
              const SizedBox(width: 6),
              Text(
                'PINNED LOCATION',
                style: KioskTheme.labelSmall.copyWith(fontSize: 11),
              ),
              const Spacer(),
              if (hasAddress)
                const Icon(
                  Icons.check_circle,
                  color: KioskTheme.success,
                  size: 18,
                ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            hasAddress ? _addressShort : 'Move the map to pin your location',
            style: KioskTheme.bodyMedium.copyWith(
              fontSize: 14,
              color: hasAddress ? KioskTheme.textPrimary : KioskTheme.textMuted,
              height: 1.4,
            ),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _address.isEmpty || _loading ? null : _confirmLocation,
            style: FilledButton.styleFrom(
              backgroundColor: KioskTheme.lunaPink,
              foregroundColor: KioskTheme.textOnPrimary,
              disabledBackgroundColor: KioskTheme.lunaBlushPaper,
              disabledForegroundColor: KioskTheme.textSecondary,
              minimumSize: const Size(48, 48),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
              ),
            ),
            child: const Text('CONFIRM LOCATION'),
          ),
        ],
      ),
    );
  }

  Widget _buildLoadingOverlay() {
    return Container(
      color: KioskTheme.lunaWhite.withValues(alpha: 0.85),
      child: const Center(
        child: CircularProgressIndicator.adaptive(
          valueColor: AlwaysStoppedAnimation<Color>(KioskTheme.lunaPink),
        ),
      ),
    );
  }
}
