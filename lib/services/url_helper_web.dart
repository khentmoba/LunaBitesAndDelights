import 'dart:js_interop';

@JS('window.open')
external void _windowOpen(JSString url, JSString target);

@JS('window.print')
external void _windowPrint();

void openExternalUrl(String url) {
  try {
    _windowOpen(url.toJS, '_blank'.toJS);
  } catch (_) {}
}

bool printWindow() {
  try {
    _windowPrint();
    return true;
  } catch (_) {
    return false;
  }
}
