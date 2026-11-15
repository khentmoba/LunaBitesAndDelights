import 'package:cloud_functions/cloud_functions.dart';
import 'firebase_init.dart';

/// One-liner for calling a us-central1 callable. Returns the response data
/// as a string-keyed map. Throws [FirebaseFunctionsException] on failure.
Future<Map<String, dynamic>> callFn(
  String name, [
  Map<String, dynamic>? params,
  int timeoutSecs = 15,
]) async {
  await ensureFirebaseInitialized();
  final callable = FirebaseFunctions.instanceFor(region: 'us-central1')
      .httpsCallable(
        name,
        options: HttpsCallableOptions(timeout: Duration(seconds: timeoutSecs)),
      );
  final result = await callable.call(params ?? {});
  return Map<String, dynamic>.from(result.data as Map);
}
