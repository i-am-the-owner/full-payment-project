import 'package:flutter/material.dart';

import '../theme/almapay_theme.dart';

/// The AaminPay mark: a gradient blue tile with a bold white "A" whose
/// crossbar is the amber line of money on its way.
class AaminMark extends StatelessWidget {
  const AaminMark({this.size = 36, super.key});
  final double size;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: CustomPaint(size: Size.square(size), painter: _MarkPainter()),
  );
}

class _MarkPainter extends CustomPainter {
  // The same geometry is used to draw the app icon files (32 x 32 units).
  @override
  void paint(Canvas canvas, Size size) {
    final k = size.width / 32;
    final tile = RRect.fromRectAndRadius(
      Offset.zero & size,
      Radius.circular(9 * k),
    );
    canvas.drawRRect(
      tile,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFF3D7BFF), Color(0xFF1A3A9E)],
        ).createShader(Offset.zero & size),
    );
    final letter = Path()
      ..moveTo(8.2 * k, 25.5 * k)
      ..lineTo(16 * k, 6.5 * k)
      ..lineTo(23.8 * k, 25.5 * k);
    canvas.drawPath(
      letter,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3.6 * k
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
    canvas.drawLine(
      Offset(11.9 * k, 19.6 * k),
      Offset(20.1 * k, 19.6 * k),
      Paint()
        ..color = AlmaPayColours.way
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3 * k
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter old) => false;
}

/// The mark with the "AaminPay" wordmark beside it.
class AaminWordmark extends StatelessWidget {
  const AaminWordmark({this.onDark = true, this.size = 28, super.key});

  final bool onDark;
  final double size;

  @override
  Widget build(BuildContext context) {
    final base = onDark ? context.palette.text : AlmaPayColours.ink;
    return Row(
      children: [
        AaminMark(size: size + 8),
        const SizedBox(width: 12),
        Text.rich(
          TextSpan(
            style: AlmaPayText.ui(size: size, weight: 700, color: base),
            children: [
              const TextSpan(text: 'Aamin'),
              TextSpan(
                text: 'Pay',
                style: TextStyle(color: context.palette.accent),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
