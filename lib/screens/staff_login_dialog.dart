import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart' hide MenuTheme;
import '../services/functions.dart';
import '../services/session.dart';
import '../widgets/kiosk/menu_theme.dart';

enum StaffLoginMode { pin, password }

class StaffLoginDialog extends StatefulWidget {
  final Widget? destinationPage;

  const StaffLoginDialog({super.key, this.destinationPage});

  @override
  State<StaffLoginDialog> createState() => _StaffLoginDialogState();
}

class _StaffLoginDialogState extends State<StaffLoginDialog> {
  StaffLoginMode _mode = StaffLoginMode.pin;
  String _pin = '';
  final _userCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  bool _obscure = true;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _userCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  void _onKeypadTap(String value) {
    if (_loading) return;
    if (_pin.length < 8) {
      setState(() {
        _error = null;
        _pin += value;
      });
      if (_pin.length == 8) {
        _submitPin();
      }
    }
  }

  void _closeOrGoMenu() {
    final isPopup = ModalRoute.of(context) is PopupRoute;
    if (isPopup && Navigator.canPop(context)) {
      Navigator.pop(context);
    } else if (Navigator.canPop(context)) {
      Navigator.pop(context);
    } else {
      Navigator.pushReplacementNamed(context, '/menu');
    }
  }

  void _onBackspace() {
    if (_loading || _pin.isEmpty) return;
    setState(() {
      _error = null;
      _pin = _pin.substring(0, _pin.length - 1);
    });
  }

  void _clearPin() {
    if (_loading) return;
    setState(() {
      _error = null;
      _pin = '';
    });
  }

  Future<void> _submitPin() async {
    if (_pin.length < 4) return;
    setState(() {
      _error = null;
      _loading = true;
    });

    try {
      final data = await callFn('verifyStaff', {'pin': _pin}, 30);
      final bool isSuccess = data['success'] == true;

      if (!mounted) return;

      if (isSuccess) {
        final actualUser = data['username'] ?? 'Staff';
        final actualRole =
            data['role'] as String? ??
            (actualUser.toLowerCase() == 'admin' ? 'admin' : 'staff');
        final token = data['customToken'] as String?;
        if (token == null || token.isEmpty) {
          setState(() {
            _error = 'Staff authentication token missing. Please try again.';
            _loading = false;
            _pin = '';
          });
          return;
        }
        await FirebaseAuth.instance.signInWithCustomToken(token);
        session.login(actualUser, role: actualRole);

        if (!mounted) return;
        final isPopup = ModalRoute.of(context) is PopupRoute;
        if (isPopup && Navigator.canPop(context)) {
          Navigator.pop(context);
        }

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(
                  Icons.verified_user_rounded,
                  color: MenuTheme.onPlate,
                ),
                const SizedBox(width: 12),
                Text(
                  'Welcome, $actualUser! (${actualRole.toUpperCase()})',
                  style: MenuTheme.body(
                    size: 14,
                    color: MenuTheme.onPlate,
                  ).copyWith(fontWeight: FontWeight.w700),
                ),
              ],
            ),
            backgroundColor: MenuTheme.plate,
            shape: const RoundedRectangleBorder(),
          ),
        );

        if (widget.destinationPage != null) {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => widget.destinationPage!),
          );
        }
      } else {
        setState(() {
          _error = data['message'] ?? 'Incorrect PIN. Please try again.';
          _loading = false;
          _pin = '';
        });
      }
    } catch (e) {
      if (!mounted) return;
      String errorMessage;
      if (e is FirebaseFunctionsException) {
        errorMessage = e.message ?? e.code;
      } else {
        errorMessage = 'Failed to connect: ${e.toString().split('\n').first}';
      }

      setState(() {
        _error = errorMessage;
        _loading = false;
        _pin = '';
      });
    }
  }

  Future<void> _submitPassword() async {
    final user = _userCtrl.text.trim();
    final pass = _passCtrl.text;

    if (user.isEmpty || pass.isEmpty) {
      setState(() {
        _error = 'Please enter both username and password.';
      });
      return;
    }

    setState(() {
      _error = null;
      _loading = true;
    });

    try {
      final data = await callFn('verifyStaff', {
        'username': user,
        'password': pass,
      }, 30);
      final bool isSuccess = data['success'] == true;

      if (!mounted) return;

      if (isSuccess) {
        final actualUser = data['username'] ?? user;
        final actualRole =
            data['role'] as String? ??
            (actualUser.toLowerCase() == 'admin' ? 'admin' : 'staff');
        final token = data['customToken'] as String?;
        if (token == null || token.isEmpty) {
          setState(() {
            _error = 'Staff authentication token missing. Please try again.';
            _loading = false;
          });
          return;
        }
        await FirebaseAuth.instance.signInWithCustomToken(token);
        session.login(actualUser, role: actualRole);

        if (!mounted) return;
        final isPopup = ModalRoute.of(context) is PopupRoute;
        if (isPopup && Navigator.canPop(context)) {
          Navigator.pop(context);
        }

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(
                  Icons.verified_user_rounded,
                  color: MenuTheme.onPlate,
                ),
                const SizedBox(width: 12),
                Text(
                  'Welcome, $actualUser!',
                  style: MenuTheme.body(
                    size: 14,
                    color: MenuTheme.onPlate,
                  ).copyWith(fontWeight: FontWeight.w700),
                ),
              ],
            ),
            backgroundColor: MenuTheme.plate,
            shape: const RoundedRectangleBorder(),
          ),
        );

        if (widget.destinationPage != null) {
          Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => widget.destinationPage!),
          );
        }
      } else {
        setState(() {
          _error =
              data['message'] ??
              'Incorrect username or password. Please try again.';
          _loading = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      String errorMessage;
      if (e is FirebaseFunctionsException) {
        errorMessage = e.message ?? e.code;
      } else {
        errorMessage = 'Failed to connect: ${e.toString().split('\n').first}';
      }

      setState(() {
        _error = errorMessage;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 420),
          margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
          decoration: BoxDecoration(
            color: MenuTheme.card,
            border: Border.all(color: MenuTheme.rule, width: 1.5),
            boxShadow: const [
              BoxShadow(
                color: Colors.black54,
                blurRadius: 32,
                offset: Offset(0, 12),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Painted Top Brass Strip
              Container(height: 3, color: MenuTheme.pinkInk),

              Padding(
                padding: const EdgeInsets.fromLTRB(28, 24, 28, 20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 58,
                      height: 58,
                      decoration: BoxDecoration(
                        color: MenuTheme.paper,
                        border: Border.all(color: MenuTheme.rule),
                      ),
                      child: Center(
                        child: Image.asset(
                          'images/luna_logo.png',
                          height: 50,
                          excludeFromSemantics: true,
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Header Signage
                    Text(
                      'STAFF OPERATIONS',
                      style: MenuTheme.heading(26).copyWith(letterSpacing: 2),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Kitchen Display System & Dispatch Board',
                      style: MenuTheme.body(size: 13, color: MenuTheme.inkSoft),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 20),

                    // Mode Switcher Tabs (Square Painted Plates)
                    Container(
                      decoration: BoxDecoration(
                        color: MenuTheme.paper,
                        border: Border.all(color: MenuTheme.rule),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: GestureDetector(
                              behavior: HitTestBehavior.opaque,
                              onTap: () {
                                if (_loading) return;
                                setState(() {
                                  _mode = StaffLoginMode.pin;
                                  _error = null;
                                });
                              },
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 10,
                                ),
                                decoration: BoxDecoration(
                                  color: _mode == StaffLoginMode.pin
                                      ? MenuTheme.card
                                      : Colors.transparent,
                                  border: _mode == StaffLoginMode.pin
                                      ? Border.all(
                                          color: MenuTheme.pinkInk,
                                          width: 1.5,
                                        )
                                      : null,
                                ),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(
                                      Icons.pin_rounded,
                                      size: 16,
                                      color: _mode == StaffLoginMode.pin
                                          ? MenuTheme.ink
                                          : MenuTheme.inkSoft,
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      'QUICK PIN',
                                      style:
                                          MenuTheme.body(
                                            size: 12,
                                            color: _mode == StaffLoginMode.pin
                                                ? MenuTheme.ink
                                                : MenuTheme.inkSoft,
                                          ).copyWith(
                                            fontWeight: FontWeight.w800,
                                            letterSpacing: 1.5,
                                          ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                          Expanded(
                            child: GestureDetector(
                              behavior: HitTestBehavior.opaque,
                              onTap: () {
                                if (_loading) return;
                                setState(() {
                                  _mode = StaffLoginMode.password;
                                  _error = null;
                                });
                              },
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 10,
                                ),
                                decoration: BoxDecoration(
                                  color: _mode == StaffLoginMode.password
                                      ? MenuTheme.card
                                      : Colors.transparent,
                                  border: _mode == StaffLoginMode.password
                                      ? Border.all(
                                          color: MenuTheme.pinkInk,
                                          width: 1.5,
                                        )
                                      : null,
                                ),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(
                                      Icons.badge_rounded,
                                      size: 16,
                                      color: _mode == StaffLoginMode.password
                                          ? MenuTheme.ink
                                          : MenuTheme.inkSoft,
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      'PASSWORD',
                                      style:
                                          MenuTheme.body(
                                            size: 12,
                                            color:
                                                _mode == StaffLoginMode.password
                                                ? MenuTheme.ink
                                                : MenuTheme.inkSoft,
                                          ).copyWith(
                                            fontWeight: FontWeight.w800,
                                            letterSpacing: 1.5,
                                          ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 18),

                    // Error Banner
                    if (_error != null) ...[
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 10,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFCE4E4),
                          border: Border.all(color: const Color(0xFFB3261E)),
                        ),
                        child: Row(
                          children: [
                            const Icon(
                              Icons.error_outline_rounded,
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
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],

                    // Mode 1: Quick PIN keypad
                    if (_mode == StaffLoginMode.pin) ...[
                      Text(
                        'ENTER 4-DIGIT PIN',
                        style:
                            MenuTheme.body(
                              size: 12,
                              color: MenuTheme.pinkInk,
                            ).copyWith(
                              fontWeight: FontWeight.w800,
                              letterSpacing: 2,
                            ),
                      ),
                      const SizedBox(height: 14),

                      // PIN indicators (4 base slots, expands up to 8)
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: List.generate(
                          _pin.length > 4 ? _pin.length : 4,
                          (index) {
                            final filled = index < _pin.length;
                            return Container(
                              margin: const EdgeInsets.symmetric(horizontal: 6),
                              width: 20,
                              height: 20,
                              decoration: BoxDecoration(
                                color: filled
                                    ? MenuTheme.plate
                                    : MenuTheme.paper,
                                border: Border.all(
                                  color: filled
                                      ? MenuTheme.pinkInk
                                      : MenuTheme.rule,
                                  width: 1.5,
                                ),
                              ),
                              child: filled
                                  ? const Center(
                                      child: Icon(
                                        Icons.square,
                                        size: 8,
                                        color: MenuTheme.onPlate,
                                      ),
                                    )
                                  : null,
                            );
                          },
                        ),
                      ),
                      const SizedBox(height: 22),

                      // Keypad
                      _buildKeypad(),
                    ] else ...[
                      // Mode 2: Username & Password
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'USERNAME',
                            style:
                                MenuTheme.body(
                                  size: 11,
                                  color: MenuTheme.pinkInk,
                                ).copyWith(
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: 1.5,
                                ),
                          ),
                          const SizedBox(height: 6),
                          TextField(
                            controller: _userCtrl,
                            textInputAction: TextInputAction.next,
                            style: MenuTheme.body(size: 14),
                            decoration: InputDecoration(
                              filled: true,
                              fillColor: MenuTheme.paper,
                              hintText: 'e.g. staff1',
                              hintStyle: MenuTheme.body(
                                size: 14,
                                color: MenuTheme.inkSoft,
                              ),
                              prefixIcon: const Icon(
                                Icons.person_outline_rounded,
                                color: MenuTheme.pinkInk,
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.zero,
                                borderSide: BorderSide(color: MenuTheme.rule),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.zero,
                                borderSide: BorderSide(
                                  color: MenuTheme.pinkInk,
                                  width: 1.5,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'PASSWORD',
                            style:
                                MenuTheme.body(
                                  size: 11,
                                  color: MenuTheme.pinkInk,
                                ).copyWith(
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: 1.5,
                                ),
                          ),
                          const SizedBox(height: 6),
                          TextField(
                            controller: _passCtrl,
                            obscureText: _obscure,
                            onSubmitted: (_) => _submitPassword(),
                            style: MenuTheme.body(size: 14),
                            decoration: InputDecoration(
                              filled: true,
                              fillColor: MenuTheme.paper,
                              hintText: '••••••••',
                              hintStyle: MenuTheme.body(
                                size: 14,
                                color: MenuTheme.inkSoft,
                              ),
                              prefixIcon: const Icon(
                                Icons.lock_outline_rounded,
                                color: MenuTheme.pinkInk,
                              ),
                              suffixIcon: GestureDetector(
                                onTap: () =>
                                    setState(() => _obscure = !_obscure),
                                child: Icon(
                                  _obscure
                                      ? Icons.visibility_off_rounded
                                      : Icons.visibility_rounded,
                                  color: MenuTheme.pinkInk,
                                  size: 20,
                                ),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.zero,
                                borderSide: BorderSide(color: MenuTheme.rule),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.zero,
                                borderSide: BorderSide(
                                  color: MenuTheme.pinkInk,
                                  width: 1.5,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 22),
                      Row(
                        children: [
                          Expanded(
                            child: InkWell(
                              onTap: _loading ? null : _closeOrGoMenu,
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 14,
                                ),
                                decoration: BoxDecoration(
                                  color: MenuTheme.paper,
                                  border: Border.all(color: MenuTheme.rule),
                                ),
                                child: Center(
                                  child: Text(
                                    'CANCEL',
                                    style:
                                        MenuTheme.body(
                                          size: 13,
                                          color: MenuTheme.inkSoft,
                                        ).copyWith(
                                          fontWeight: FontWeight.w800,
                                          letterSpacing: 1.5,
                                        ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: InkWell(
                              onTap: _loading ? null : _submitPassword,
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 14,
                                ),
                                decoration: const BoxDecoration(
                                  color: MenuTheme.plate,
                                ),
                                child: Center(
                                  child: _loading
                                      ? const SizedBox(
                                          width: 18,
                                          height: 18,
                                          child: CircularProgressIndicator(
                                            color: MenuTheme.onPlate,
                                            strokeWidth: 2,
                                          ),
                                        )
                                      : Text(
                                          'LOG IN',
                                          style:
                                              MenuTheme.body(
                                                size: 13,
                                                color: MenuTheme.onPlate,
                                              ).copyWith(
                                                fontWeight: FontWeight.w800,
                                                letterSpacing: 1.5,
                                              ),
                                        ),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],

                    const SizedBox(height: 16),
                    // Cancel / Return button
                    if (_mode == StaffLoginMode.pin)
                      TextButton(
                        onPressed: _loading ? null : _closeOrGoMenu,
                        child: Text(
                          'CANCEL & RETURN TO KIOSK',
                          style:
                              MenuTheme.body(
                                size: 11,
                                color: MenuTheme.inkSoft,
                              ).copyWith(
                                fontWeight: FontWeight.w700,
                                letterSpacing: 1.5,
                              ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildKeypad() {
    return Container(
      constraints: const BoxConstraints(maxWidth: 290),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildDigitButton('1'),
              _buildDigitButton('2'),
              _buildDigitButton('3'),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildDigitButton('4'),
              _buildDigitButton('5'),
              _buildDigitButton('6'),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildDigitButton('7'),
              _buildDigitButton('8'),
              _buildDigitButton('9'),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildActionButton(
                icon: Icons.backspace_outlined,
                onTap: _onBackspace,
                onLongPress: _clearPin,
              ),
              _buildDigitButton('0'),
              _buildSubmitButton(),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDigitButton(String digit) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: _loading ? null : () => _onKeypadTap(digit),
      child: Container(
        width: 72,
        height: 58,
        decoration: BoxDecoration(
          color: MenuTheme.paper,
          border: Border.all(color: MenuTheme.rule),
        ),
        child: Center(
          child: Text(
            digit,
            style: MenuTheme.heading(26).copyWith(color: MenuTheme.ink),
          ),
        ),
      ),
    );
  }

  Widget _buildActionButton({
    required IconData icon,
    required VoidCallback onTap,
    VoidCallback? onLongPress,
  }) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: _loading ? null : onTap,
      onLongPress: onLongPress,
      child: Container(
        width: 72,
        height: 58,
        decoration: BoxDecoration(
          color: MenuTheme.paper,
          border: Border.all(color: MenuTheme.rule),
        ),
        child: Center(child: Icon(icon, size: 20, color: MenuTheme.pinkInk)),
      ),
    );
  }

  Widget _buildSubmitButton() {
    final canSubmit = _pin.length >= 4;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: _loading || !canSubmit ? null : _submitPin,
      child: Container(
        width: 72,
        height: 58,
        decoration: BoxDecoration(
          color: canSubmit ? MenuTheme.plate : MenuTheme.paper,
          border: Border.all(
            color: canSubmit ? MenuTheme.pinkInk : MenuTheme.rule,
          ),
        ),
        child: Center(
          child: _loading
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    color: MenuTheme.onPlate,
                    strokeWidth: 2,
                  ),
                )
              : Icon(
                  Icons.arrow_forward_rounded,
                  size: 22,
                  color: canSubmit ? MenuTheme.onPlate : MenuTheme.inkSoft,
                ),
        ),
      ),
    );
  }
}
