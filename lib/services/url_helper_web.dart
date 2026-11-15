import 'dart:js_interop';

@JS('window.open')
external void _windowOpen(JSString url, JSString target);

@JS('window.print')
external void _windowPrint();

@JS('window.history.state')
external JSAny? get _historyState;

@JS('window.history.replaceState')
external void _replaceState(JSAny? state, JSString unused, JSString url);

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

void replaceUrl(String url) {
  try {
    _replaceState(_historyState, ''.toJS, url.toJS);
  } catch (_) {}
}
