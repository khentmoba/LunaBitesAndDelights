import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import 'location_stub.dart'
    if (dart.library.js_interop) 'location_web.dart'
    as web_location;

/// Best-effort current position. Returns null when location is unavailable,
/// denied, or times out — never throws.
Future<LatLng?> currentPosition() async {
  try {
    if (kIsWeb) return await web_location.currentPositionOnWeb();
    return await _mobilePosition();
  } catch (_) {
    return null;
  }
}

Future<LatLng?> _mobilePosition() async {
  final enabled = await Geolocator.isLocationServiceEnabled().timeout(
    const Duration(seconds: 5),
    onTimeout: () => false,
  );
  if (!enabled) return null;

  var permission = await Geolocator.checkPermission().timeout(
    const Duration(seconds: 5),
    onTimeout: () => LocationPermission.denied,
  );
  if (permission == LocationPermission.denied) {
    permission = await Geolocator.requestPermission().timeout(
      const Duration(seconds: 10),
      onTimeout: () => LocationPermission.denied,
    );
    if (permission == LocationPermission.denied) return null;
  }
  if (permission == LocationPermission.deniedForever) return null;

  final pos = await Geolocator.getCurrentPosition(
    locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
  ).timeout(const Duration(seconds: 10));
  return LatLng(pos.latitude, pos.longitude);
}
