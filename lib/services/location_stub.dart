import 'package:latlong2/latlong.dart';

/// Non-web builds never ask the browser for a position.
Future<LatLng?> currentPositionOnWeb() async => null;
