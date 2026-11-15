import 'url_helper_stub.dart'
    if (dart.library.js_interop) 'url_helper_web.dart'
    as helper_impl;

void openUrlInBrowser(String url) {
  try {
    helper_impl.openExternalUrl(url);
  } catch (_) {}
}

bool printCurrentPage() {
  try {
    return helper_impl.printWindow();
  } catch (_) {
    return false;
  }
}

/// Swaps the address bar URL without a navigation or a new history entry.
void replaceBrowserUrl(String url) {
  try {
    helper_impl.replaceUrl(url);
  } catch (_) {}
}
