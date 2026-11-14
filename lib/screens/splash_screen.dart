import 'package:flutter/material.dart';
import '../widgets/kiosk/kiosk_theme.dart';
import '../widgets/kiosk/juicy_feedback.dart';
import '../services/session.dart';
import 'menu_page.dart';
import 'staff_screens.dart';

class KioskSplashScreen extends StatefulWidget {
  const KioskSplashScreen({super.key});

  @override
  State<KioskSplashScreen> createState() => _KioskSplashScreenState();
}

class _KioskSplashScreenState extends State<KioskSplashScreen>
    with TickerProviderStateMixin {
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;
  late AnimationController _floatController;
  late Animation<Offset> _floatAnimation;
  late AnimationController _fadeController;
  late Animation<double> _fadeAnimation;
  late AnimationController _dotsController;
  late AnimationController _scaleController;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();

    _scaleController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );
    _scaleAnimation = CurvedAnimation(
      parent: _scaleController,
      curve: Curves.easeOutCubic,
    );
    _scaleController.forward();

    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    )..repeat(reverse: true);
    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.05).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    _floatController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2000),
    )..repeat(reverse: true);
    _floatAnimation =
        Tween<Offset>(begin: Offset.zero, end: const Offset(0, 10)).animate(
          CurvedAnimation(parent: _floatController, curve: Curves.easeInOut),
        );

    _fadeController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..forward();
    _fadeAnimation = CurvedAnimation(
      parent: _fadeController,
      curve: Curves.easeOut,
    );

    _dotsController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _pulseController.stop();
      _pulseController.value = 0;
      _floatController.stop();
      _floatController.value = 0;
      _dotsController.stop();
      _dotsController.value = 0;
      _scaleController.value = 1;
      _fadeController.value = 1;
    }
  }

  @override
  void dispose() {
    _pulseController.dispose();
    _floatController.dispose();
    _fadeController.dispose();
    _dotsController.dispose();
    _scaleController.dispose();
    super.dispose();
  }

  void _onStart() {
    Navigator.pushReplacement(
      context,
      PageRouteBuilder(
        pageBuilder: (context, animation, secondaryAnimation) => session.isStaff
            ? const DeferredStaffScreen(StaffScreen.dashboard)
            : const KioskMenuPage(),
        transitionsBuilder: (context, animation, secondaryAnimation, child) {
          return FadeTransition(opacity: animation, child: child);
        },
        transitionDuration: KioskTheme.kPageTransition,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    return Scaffold(
      backgroundColor: KioskTheme.lunaBlush,
      body: Stack(
        children: [
          Positioned.fill(
            child: Image.asset(
              'images/pink_wash.jpg',
              fit: BoxFit.cover,
              excludeFromSemantics: true,
            ),
          ),
          SafeArea(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final compact = constraints.maxHeight < 620;
                final logoSize = compact
                    ? (constraints.maxHeight * 0.28).clamp(120.0, 200.0)
                    : 240.0;
                return SingleChildScrollView(
                  padding: EdgeInsets.symmetric(
                    horizontal: 24,
                    vertical: compact ? 16 : 28,
                  ),
                  child: ConstrainedBox(
                    constraints: BoxConstraints(
                      minHeight: (constraints.maxHeight - (compact ? 32 : 56))
                          .clamp(0.0, double.infinity),
                    ),
                    child: FadeTransition(
                      opacity: _fadeAnimation,
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const SizedBox(height: 8),
                          Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              AnimatedBuilder(
                                animation: _floatAnimation,
                                builder: (context, child) {
                                  return Transform.translate(
                                    offset: reduceMotion
                                        ? Offset.zero
                                        : _floatAnimation.value,
                                    child: child,
                                  );
                                },
                                child: FadeTransition(
                                  opacity: _scaleAnimation,
                                  child: SizedBox(
                                    width: logoSize,
                                    height: logoSize * 1.2,
                                    child: Image.asset(
                                      'images/luna_logo.webp',
                                      semanticLabel: 'Luna Bites & Delights',
                                      errorBuilder:
                                          (context, error, stackTrace) =>
                                              const Icon(
                                                Icons.nightlight_round,
                                                size: 100,
                                                color: KioskTheme.lunaPink,
                                              ),
                                    ),
                                  ),
                                ),
                              ),
                              SizedBox(height: compact ? 16 : 24),
                              FadeTransition(
                                opacity: _scaleAnimation,
                                child: Container(
                                  padding: const EdgeInsets.fromLTRB(
                                    22,
                                    14,
                                    22,
                                    16,
                                  ),
                                  decoration: BoxDecoration(
                                    color: KioskTheme.lunaPaper,
                                    borderRadius: BorderRadius.circular(
                                      KioskTheme.radiusSm,
                                    ),
                                    boxShadow: KioskTheme.shadowMd,
                                  ),
                                  child: Text(
                                    'Good food, sweet drinks, moonlit vibes.',
                                    textAlign: TextAlign.center,
                                    style: KioskTheme.hand(
                                      fontSize: compact ? 24 : 28,
                                    ),
                                  ),
                                ),
                              ),
                              SizedBox(height: compact ? 18 : 28),
                              _buildLoadingDots(),
                            ],
                          ),
                          Padding(
                            padding: EdgeInsets.only(
                              top: compact ? 20 : 32,
                              bottom: compact ? 12 : 32,
                            ),
                            child: _buildStartButton(reduceMotion),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLoadingDots() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(3, (index) {
        return AnimatedBuilder(
          animation: _dotsController,
          builder: (context, child) {
            final double offset = (index * 0.2);
            final double value = (_dotsController.value - offset).clamp(
              0.0,
              1.0,
            );
            final double opacity = 1.0 - value;

            return Container(
              width: 10,
              height: 10,
              margin: const EdgeInsets.symmetric(horizontal: 4),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(2),
                color: KioskTheme.lunaPink.withValues(
                  alpha: opacity.clamp(0.2, 1.0),
                ),
              ),
            );
          },
        );
      }),
    );
  }

  Widget _buildStartButton(bool reduceMotion) {
    final button = Container(
      decoration: BoxDecoration(
        color: KioskTheme.lunaPink,
        borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
        boxShadow: KioskTheme.shadowPrimary,
      ),
      padding: const EdgeInsets.all(4),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(KioskTheme.radiusSm),
          onTap: _onStart,
          child: Container(
            constraints: const BoxConstraints(minHeight: 52),
            padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(KioskTheme.radiusSm),
              border: Border.all(
                color: Colors.white.withValues(alpha: .6),
                width: 1.5,
              ),
            ),
            child: Text(
              'Start my order',
              textAlign: TextAlign.center,
              style: KioskTheme.font(
                color: KioskTheme.textOnPrimary,
                fontSize: 21,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ),
      ),
    );
    final semanticButton = Semantics(
      button: true,
      label: 'Start my order',
      child: JuicyFeedback(child: button),
    );
    if (reduceMotion) return semanticButton;
    return ScaleTransition(scale: _pulseAnimation, child: semanticButton);
  }
}
