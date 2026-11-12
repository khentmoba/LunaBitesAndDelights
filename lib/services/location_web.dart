import 'dart:async';
import 'dart:js_interop';

import 'package:latlong2/latlong.dart';

/// The parts of the browser Geolocation API this app reads.
extension type _Coordinates(JSObject _) implements JSObject {
  external JSNumber get latitude;
  external JSNumber get longitude;
}

extension type _Position(JSObject _) implements JSObject {
  external _Coordinates get coords;
}

extension type _Geolocation(JSObject _) implements JSObject {
  external void getCurrentPosition(
    JSFunction onSuccess,
    JSFunction onError,
    JSObject options,
  );
}

@JS('navigator.geolocation')
external _Geolocation? get _geolocation;

/// Best-effort position from the browser. Returns null when the browser exposes
/// no geolocation, the user denies the prompt, or the request times out.
Future<LatLng?> currentPositionOnWeb() async {
  final geolocation = _geolocation;
  if (geolocation == null) return null;

  final completer = Completer<LatLng?>();

  void onSuccess(_Position position) {
    if (completer.isCompleted) return;
    final coords = position.coords;
    completer.complete(
      LatLng(coords.latitude.toDartDouble, coords.longitude.toDartDouble),
    );
  }

  void onError(JSAny? _) {
    if (completer.isCompleted) return;
    completer.complete(null);
  }

  geolocation.getCurrentPosition(
    onSuccess.toJS,
    onError.toJS,
    <String, Object>{
          'enableHighAccuracy': true,
          'timeout': 10000,
          'maximumAge': 0,
        }.jsify()
        as JSObject,
  );

  return completer.future.timeout(
    const Duration(seconds: 12),
    onTimeout: () => null,
  );
}
