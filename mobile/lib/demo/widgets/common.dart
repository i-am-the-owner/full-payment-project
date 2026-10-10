import 'package:flutter/material.dart';

import '../demo_models.dart';
import '../demo_theme.dart';

/// A round avatar with the person's initials, in their destination's colour.
class Avatar extends StatelessWidget {
  const Avatar(this.person, {this.size = 44, super.key});
  final Person person;
  final double size;

  @override
  Widget build(BuildContext context) {
    final d = person.destination;
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: d.soft, shape: BoxShape.circle),
      child: Text(
        person.initials,
        style: DemoText.display.copyWith(
          fontSize: size * 0.42,
          color: DemoColours.ink,
        ),
      ),
    );
  }
}

/// A white rounded card.
class Panel extends StatelessWidget {
  const Panel({
    required this.child,
    this.padding = const EdgeInsets.all(16),
    super.key,
  });
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: DemoColours.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: DemoColours.line),
      ),
      child: child,
    );
  }
}

/// `label ............ value`.
class KeyValueRow extends StatelessWidget {
  const KeyValueRow(this.label, this.value, {this.bold = false, super.key});
  final String label;
  final String value;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Flexible(
            flex: 3,
            child: Text(label, style: const TextStyle(color: DemoColours.ink2)),
          ),
          const SizedBox(width: 12),
          Flexible(
            flex: 4,
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: TextStyle(
                fontWeight: bold ? FontWeight.w700 : FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The ticket colour for a status: amber on its way, green paid, red refused.
Color ticketBand(DemoStatus s) => switch (s) {
  DemoStatus.awaitingPayment => DemoColours.blue,
  DemoStatus.paymentReceived || DemoStatus.converting => DemoColours.marigold,
  DemoStatus.delivered => DemoColours.paid,
  DemoStatus.returning || DemoStatus.returned => DemoColours.refused,
};

/// The AaminPay mark: a route between two places, drawn as a blue tile.
class AaminMark extends StatelessWidget {
  const AaminMark({this.size = 36, super.key});
  final double size;

  @override
  Widget build(BuildContext context) =>
      CustomPaint(size: Size.square(size), painter: _MarkPainter());
}

class _MarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final k = size.width / 32;
    final tile = RRect.fromRectAndRadius(
      Offset.zero & size,
      Radius.circular(9 * k),
    );
    canvas.drawRRect(tile, Paint()..color = DemoColours.blue);
    canvas.save();
    canvas.clipRRect(tile);
    final navy = Paint()..color = DemoColours.ink;
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

/// A coloured status pill.
(Color, Color) badgeColours(DemoStatus s) => switch (s) {
  DemoStatus.awaitingPayment => (DemoColours.blueSoft, DemoColours.blue),
  DemoStatus.paymentReceived ||
  DemoStatus.converting => (DemoColours.waitSoft, DemoColours.wait),
  DemoStatus.delivered => (DemoColours.okSoft, DemoColours.ok),
  DemoStatus.returning ||
  DemoStatus.returned => (DemoColours.badSoft, DemoColours.bad),
};

/// A screen title in the display face.
class ScreenTitle extends StatelessWidget {
  const ScreenTitle(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        text,
        style: DemoText.display.copyWith(fontSize: 34, height: 1),
      ),
    );
  }
}
