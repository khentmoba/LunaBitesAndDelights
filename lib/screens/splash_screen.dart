import 'package:flutter/material.dart';
import '../widgets/kiosk/kiosk_theme.dart';
import '../widgets/kiosk/juicy_feedback.dart';
import '../services/session.dart';
import 'menu_page.dart';
import 'admin_dashboard.dart';

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
        pageBuilder: (context, animation, secondaryAnimation) =>
            session.isStaff ? const AdminDashboard() : const KioskMenuPage(),
        transitionsBuilder: (context, animation, secondaryAnimation, child) {
          return FadeTransition(opacity: animation, child: child);
        },
        transitionDuration: KioskTheme.kPageTransition,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
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
          FadeTransition(
            opacity: _fadeAnimation,
            child: Column(
              children: [
                const Spacer(flex: 2),
                AnimatedBuilder(
                  animation: _floatAnimation,
                  builder: (context, child) {
                    return Transform.translate(
                      offset: _floatAnimation.value,
                      child: child,
                    );
                  },
                  child: FadeTransition(
                    opacity: _scaleAnimation,
                    child: SizedBox(
                      width: 260,
                      height: 312,
                      child: Image.asset(
                        'images/luna_logo.png',
                        semanticLabel: 'Luna Bites & Delights',
                        errorBuilder: (context, error, stackTrace) =>
                            const Icon(
                              Icons.nightlight_round,
                              size: 100,
                              color: KioskTheme.lunaPink,
                            ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                FadeTransition(
                  opacity: _scaleAnimation,
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 24),
                    padding: const EdgeInsets.fromLTRB(22, 14, 22, 16),
                    decoration: BoxDecoration(
                      color: KioskTheme.lunaPaper,
                      borderRadius: BorderRadius.circular(KioskTheme.radiusSm),
                      boxShadow: KioskTheme.shadowMd,
                    ),
                    child: Text(
                      'Good food, sweet drinks, moonlit vibes.',
                      textAlign: TextAlign.center,
                      style: KioskTheme.hand(fontSize: 28),
                    ),
                  ),
                ),
                const SizedBox(height: 32),
                _buildLoadingDots(),
                const Spacer(),
                Padding(
                  padding: const EdgeInsets.only(bottom: 100),
                  child: _buildStartButton(),
                ),
                const SizedBox(height: 20),
              ],
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

  Widget _buildStartButton() {
    return ScaleTransition(
      scale: _pulseAnimation,
      child: JuicyFeedback(
        onPressed: _onStart,
        child: Container(
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: KioskTheme.lunaPink,
            borderRadius: BorderRadius.circular(KioskTheme.radiusMd),
            boxShadow: KioskTheme.shadowPrimary,
          ),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 48, vertical: 18),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(KioskTheme.radiusSm),
              border: Border.all(
                color: Colors.white.withValues(alpha: .6),
                width: 1.5,
              ),
            ),
            child: Text(
              'Start my order',
              style: KioskTheme.font(
                color: KioskTheme.textOnPrimary,
                fontSize: 22,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
