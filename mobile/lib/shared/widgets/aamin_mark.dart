import 'package:flutter/material.dart';

import '../theme/almapay_theme.dart';

/// The AaminPay mark: a route between two places, drawn as a blue tile.
class AaminMark extends StatelessWidget {
  const AaminMark({this.size = 36, super.key});
  final double size;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: CustomPaint(size: Size.square(size), painter: _MarkPainter()),
  );
}

class _MarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final k = size.width / 32;
    final tile = RRect.fromRectAndRadius(
      Offset.zero & size,
      Radius.circular(9 * k),
    );
    canvas.drawRRect(tile, Paint()..color = AlmaPayColours.blue);
    canvas.save();
    canvas.clipRRect(tile);
    final navy = Paint()..color = AlmaPayColours.ink;
    canvas.drawCircle(Offset(0, 16 * k), 4 * k, navy);
    canvas.drawCircle(Offset(32 * k, 16 * k), 4 * k, navy);
    canvas.restore();
    final white = Paint()..color = Colors.white;
    for (var x = 8.0; x < 18; x += 5.6) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(x * k, 14.8 * k, 2.6 * k, 2.4 * k),
          Radius.circular(1.2 * k),
        ),
        white,
      );
    }
    canvas.drawCircle(Offset(23 * k, 16 * k), 3.2 * k, white);
  }

  @override
  bool shouldRepaint(covariant CustomPainter old) => false;
}

/// The mark with the lower-case wordmark beside it.
class AaminWordmark extends StatelessWidget {
  const AaminWordmark({this.onDark = true, this.size = 28, super.key});

  final bool onDark;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        AaminMark(size: size + 4),
        const SizedBox(width: 10),
        Text(
          'aaminpay',
          style: AlmaPayText.display.copyWith(
            fontSize: size,
            color: onDark ? AlmaPayColours.white : AlmaPayColours.ink,
          ),
        ),
      ],
    );
  }
}
