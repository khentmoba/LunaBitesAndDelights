import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../services/functions.dart';
import '../services/url_helper.dart';
import '../widgets/kiosk/kiosk_theme.dart';

class GCashCheckoutPage extends StatefulWidget {
  /// Firestore document id of the saved order — the payment result is written
  /// back to this document, so it must be the real one, not the display number.
  final String orderDocId;
  final String orderId;
  final int amount;
  final List<Map<String, dynamic>> items;
  final String customerName;
  final String customerPhone;
  final Future<Map<String, dynamic>> Function(
    String name, [
    Map<String, dynamic>? payload,
  ])?
  callFunction;
  @visibleForTesting
  final bool? webCheckoutOverride;

  const GCashCheckoutPage({
    super.key,
    required this.orderDocId,
    required this.orderId,
    required this.amount,
    required this.items,
    required this.customerName,
    required this.customerPhone,
    this.callFunction,
    this.webCheckoutOverride,
  });

  @override
  State<GCashCheckoutPage> createState() => _GCashCheckoutPageState();
}

class _GCashCheckoutPageState extends State<GCashCheckoutPage> {
  WebViewController? _controller;
  bool _loading = true;
  bool _verifying = false;
  String? _error;
  String? _verifyError;
  String? _checkoutUrl;
  String? _checkoutSessionId;

  bool get _useWebCheckout => widget.webCheckoutOverride ?? kIsWeb;

  Future<Map<String, dynamic>> _callFn(
    String name, [
    Map<String, dynamic>? payload,
  ]) {
    final fn = widget.callFunction;
    if (fn != null) return fn(name, payload);
    return callFn(name, payload);
  }

  @override
  void initState() {
    super.initState();
    if (!_useWebCheckout) {
      _controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setNavigationDelegate(
          NavigationDelegate(
            onNavigationRequest: (request) {
              if (request.url.contains('payment/success') ||
                  request.url.contains('checkout_sessions/success')) {
                _verifyAndFinish();
                return NavigationDecision.prevent;
              }
              if (request.url.contains('payment/cancel') ||
                  request.url.contains('checkout_sessions/cancel') ||
                  request.url.contains('payment/failed')) {
                _onPaymentResult(false);
                return NavigationDecision.prevent;
              }
              // #15: only allow payment-provider + app hosts in the WebView.
              final host = Uri.tryParse(request.url)?.host ?? '';
              const allowed = [
                'lunabitesanddelights.web.app',
                'lunabitesanddelights.firebaseapp.com',
                'lunaexpress.web.app',
                'lunaexpress.firebaseapp.com',
                'paymongo.com',
                'gcash.com',
                'paymaya.com',
                'maya.ph',
              ];
              if (allowed.any((a) => host == a || host.endsWith('.$a'))) {
                return NavigationDecision.navigate;
              }
              return NavigationDecision.prevent;
            },
            onPageFinished: (_) {
              if (mounted) setState(() => _loading = false);
            },
            onWebResourceError: (err) {
              if (mounted) setState(() => _error = err.description);
            },
          ),
        );
    }
    _startCheckout();
  }

  Future<void> _startCheckout() async {
    try {
      final data = await _callFn('createCheckoutSession', {
        'orderDocId': widget.orderDocId,
        'orderId': widget.orderId,
        'amount': widget.amount,
        'items': widget.items,
        'customerName': widget.customerName,
        'customerPhone': widget.customerPhone,
      });

      final checkoutUrl = data['checkoutUrl'] as String;
      final sessionId = data['checkoutSessionId']?.toString();
      if (_useWebCheckout) {
        if (!mounted) return;
        setState(() {
          _checkoutUrl = checkoutUrl;
          _checkoutSessionId = sessionId;
          _loading = false;
        });
        if (widget.webCheckoutOverride == null) {
          openUrlInBrowser(checkoutUrl);
        }
      } else {
        _checkoutSessionId = sessionId;
        await _controller?.loadRequest(Uri.parse(checkoutUrl));
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _verifyAndFinish() async {
    if (_verifying) return;
    final sessionId = _checkoutSessionId;
    if (sessionId == null || sessionId.isEmpty) {
      setState(() {
        _verifyError = 'Checkout session is not ready yet. Please wait.';
      });
      return;
    }
    setState(() {
      _verifying = true;
      _verifyError = null;
    });
    try {
      final res = await _callFn('verifyCheckoutPayment', {
        'orderDocId': widget.orderDocId,
        'checkoutSessionId': sessionId,
      });
      if (!mounted) return;
      if (res['paid'] == true) {
        _onPaymentResult(true);
      } else {
        final failed = res['paymentStatus'] == 'PAYMENT_FAILED';
        setState(() {
          _verifying = false;
          _verifyError = failed
              ? 'Payment was declined or failed. Please try paying again.'
              : 'Payment has not cleared yet. Finish authorizing in the PayMongo tab, then tap again.';
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _verifying = false;
        _verifyError =
            'Unable to verify payment right now. Check your connection and try again.';
      });
    }
  }

  void _onPaymentResult(bool success) {
    Navigator.pop(context, success);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: Text(
          'GCASH PAYMENT',
          style: KioskTheme.font(
            color: KioskTheme.textOnPrimary,
            fontWeight: FontWeight.w800,
            fontSize: 16,
            letterSpacing: 2,
          ),
        ),
        centerTitle: true,
        backgroundColor: KioskTheme.lunaPink,
        foregroundColor: KioskTheme.textOnPrimary,
        elevation: 0,
        leading: IconButton(
          tooltip: 'Back',
          icon: Icon(Icons.adaptive.arrow_back),
          onPressed: () => _onPaymentResult(false),
        ),
      ),
      body: SafeArea(
        top: false,
        child: _error != null
            ? Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.error_outline_rounded,
                        size: 64,
                        color: KioskTheme.error,
                      ),
                      const SizedBox(height: 16),
                      Text(
                        'Payment Error',
                        style: KioskTheme.headerSmall.copyWith(
                          color: KioskTheme.error,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: KioskTheme.bodyMedium.copyWith(fontSize: 13),
                      ),
                      const SizedBox(height: 24),
                      FilledButton.icon(
                        onPressed: () => _onPaymentResult(false),
                        icon: Icon(Icons.adaptive.arrow_back),
                        label: const Text('GO BACK'),
                        style: FilledButton.styleFrom(
                          backgroundColor: KioskTheme.lunaPink,
                        ),
                      ),
                    ],
                  ),
                ),
              )
            : _useWebCheckout
            ? _buildWebCheckoutBody()
            : Stack(
                children: [
                  if (_controller != null)
                    WebViewWidget(controller: _controller!),
                  if (_loading)
                    Container(
                      color: Colors.white,
                      child: const Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            CircularProgressIndicator.adaptive(
                              valueColor: AlwaysStoppedAnimation<Color>(
                                KioskTheme.lunaPink,
                              ),
                            ),
                            SizedBox(height: 16),
                            Text(
                              'Connecting to GCash...',
                              style: TextStyle(
                                fontSize: 14,
                                color: KioskTheme.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
      ),
    );
  }

  Widget _buildWebCheckoutBody() {
    if (_loading) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator.adaptive(
              valueColor: AlwaysStoppedAnimation<Color>(KioskTheme.lunaPink),
            ),
            SizedBox(height: 16),
            Text(
              'Preparing GCash checkout...',
              style: TextStyle(fontSize: 14, color: KioskTheme.textSecondary),
            ),
          ],
        ),
      );
    }

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.phone_android_rounded,
                size: 56,
                color: Color(0xFF007DFE),
              ),
              const SizedBox(height: 16),
              Text(
                'Complete GCash Payment',
                style: KioskTheme.headerSmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 10),
              Text(
                'Order #${widget.orderId} · ₱${widget.amount}\n'
                'Finish authorizing your payment in the PayMongo tab, then return here.',
                style: KioskTheme.bodyMedium.copyWith(fontSize: 14),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              if (_checkoutUrl != null) ...[
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () => openUrlInBrowser(_checkoutUrl!),
                    icon: const Icon(Icons.open_in_new_rounded),
                    label: const Text('OPEN PAYMENT PAGE'),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF007DFE),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              if (_verifyError != null) ...[
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 14),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: KioskTheme.error.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(KioskTheme.radiusSm),
                    border: Border.all(
                      color: KioskTheme.error.withValues(alpha: 0.35),
                    ),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.error_outline_rounded,
                        size: 18,
                        color: KioskTheme.error,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _verifyError!,
                          style: KioskTheme.bodySmall.copyWith(
                            color: KioskTheme.error,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _verifying ? null : _verifyAndFinish,
                  icon: _verifying
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.check_circle_outline_rounded),
                  label: Text(
                    _verifying
                        ? 'VERIFYING PAYMENT...'
                        : 'I HAVE PAID — VIEW RECEIPT',
                  ),
                  style: FilledButton.styleFrom(
                    backgroundColor: KioskTheme.lunaPink,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: _verifying ? null : () => _onPaymentResult(false),
                  child: const Text('CANCEL PAYMENT'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
