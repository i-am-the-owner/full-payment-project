import 'package:flutter/material.dart';

import '../theme/almapay_theme.dart';

/// The one bold component of the design: a coloured top, a perforation with a
/// notch on each side, and a white stub. Notches and perforation are fixed;
/// only the top colour changes (blue until the money moves, amber on its way,
/// green when paid, red if refused).
class AaminTicket extends StatelessWidget {
  const AaminTicket({
    required this.top,
    required this.stub,
    this.topHeight = 150,
    this.band = AlmaPayColours.blue,
    this.topPadding = const EdgeInsets.fromLTRB(22, 20, 22, 18),
    this.stubPadding = const EdgeInsets.fromLTRB(22, 16, 22, 20),
    this.onBand = AlmaPayColours.white,
    this.bandGradient,
    this.onTap,
    super.key,
  });

  final Widget top;
  final Widget stub;
  final double topHeight;
  final Color band;
  final Color onBand;

  /// Replaces [band] with a gradient (the split blue and green ticket).
  final Gradient? bandGradient;
  final EdgeInsets topPadding;
  final EdgeInsets stubPadding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final card = ClipPath(
      clipper: _TicketClipper(notchY: topHeight),
      child: ColoredBox(
        color: AlmaPayColours.white,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              height: topHeight,
              padding: topPadding,
              decoration: BoxDecoration(
                color: bandGradient == null ? band : null,
                gradient: bandGradient,
              ),
              child: DefaultTextStyle.merge(
                style: TextStyle(color: onBand),
                child: IconTheme(
                  data: IconThemeData(color: onBand),
                  child: top,
                ),
              ),
            ),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 22),
              child: _Perforation(),
            ),
            Padding(padding: stubPadding, child: stub),
          ],
        ),
      ),
    );
    if (onTap == null) return card;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: card,
    );
  }

  /// A blue-to-green split, half each, as on the home and review tickets.
  static const split = LinearGradient(
    stops: [0.5, 0.5],
    colors: [AlmaPayColours.blue, AlmaPayColours.paid],
  );
}

/// The route on a ticket: `GBP - - - - - ● KES`, with a city and time under
/// each end. Codes use the display face.
class TicketRoute extends StatelessWidget {
  const TicketRoute({
    required this.from,
    required this.to,
    this.fromCaption,
    this.toCaption,
    this.codeSize = 58,
    super.key,
  });

  final String from;
  final String to;
  final String? fromCaption;
  final String? toCaption;
  final double codeSize;

  @override
  Widget build(BuildContext context) {
    final color = DefaultTextStyle.of(context).style.color;
    final code = AlmaPayText.display.copyWith(
      fontSize: codeSize,
      height: .85,
      color: color,
    );
    final cap = AlmaPayText.ui(
      size: 12.5,
      weight: 500,
      color: color ?? Colors.white,
    );
    return LayoutBuilder(
      builder: (context, box) => Column(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _fit(Text(from, style: code), box.maxWidth * .42),
              Expanded(
                child: Padding(
                  padding: EdgeInsets.only(top: codeSize * .36),
                  child: const _RouteLine(),
                ),
              ),
              _fit(Text(to, style: code), box.maxWidth * .42),
            ],
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Flexible(
                child: Text(
                  fromCaption ?? '',
                  style: cap,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Flexible(
                child: Text(
                  toCaption ?? '',
                  style: cap,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.end,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A route code at its natural size, shrunk only if it would crowd the line.
Widget _fit(Widget child, double maxWidth) => ConstrainedBox(
  constraints: BoxConstraints(maxWidth: maxWidth),
  child: FittedBox(fit: BoxFit.scaleDown, child: child),
);

class _RouteLine extends StatelessWidget {
  const _RouteLine();

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 12,
    child: CustomPaint(
      painter: _RoutePainter(
        DefaultTextStyle.of(context).style.color ?? Colors.white,
      ),
    ),
  );
}

class _RoutePainter extends CustomPainter {
  _RoutePainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final y = size.height / 2;
    final paint = Paint()
      ..color = color.withValues(alpha: .7)
      ..strokeWidth = 2;
    for (var x = 12.0; x < size.width - 14; x += 8) {
      canvas.drawLine(Offset(x, y), Offset(x + 4, y), paint);
    }
    canvas.drawCircle(Offset(size.width - 6, y), 4.5, Paint()..color = color);
  }

  @override
  bool shouldRepaint(covariant _RoutePainter old) => old.color != color;
}

class _Perforation extends StatelessWidget {
  const _Perforation();

  @override
  Widget build(BuildContext context) => CustomPaint(
    painter: _PerfPainter(),
    size: const Size(double.infinity, 2),
  );
}

class _PerfPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AlmaPayColours.line
      ..strokeWidth = 2;
    for (var x = 0.0; x < size.width; x += 6) {
      canvas.drawLine(
        Offset(x, 1),
        Offset((x + 3).clamp(0, size.width), 1),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter old) => false;
}

class _TicketClipper extends CustomClipper<Path> {
  const _TicketClipper({required this.notchY});
  final double notchY;

  @override
  Path getClip(Size size) {
    final base = Path()
      ..addRRect(
        RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(26)),
      );
    final notches = Path()
      ..addOval(Rect.fromCircle(center: Offset(0, notchY), radius: 15))
      ..addOval(
        Rect.fromCircle(center: Offset(size.width, notchY), radius: 15),
      );
    return Path.combine(PathOperation.difference, base, notches);
  }

  @override
  bool shouldReclip(covariant _TicketClipper old) => old.notchY != notchY;
}
