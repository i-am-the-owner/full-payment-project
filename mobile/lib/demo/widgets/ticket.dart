import 'package:flutter/material.dart';

import '../demo_models.dart';
import '../demo_money.dart';
import '../demo_theme.dart';

/// The one bold thing: a transfer drawn as a ticket between two places, coloured
/// by the destination, with a tear-off stub for the amount.
/// Height of the coloured top of the ticket.
const double _band = 112;

class Ticket extends StatelessWidget {
  const Ticket({
    required this.destination,
    required this.fromCity,
    required this.toCity,
    required this.label,
    required this.amountMinor,
    this.fromTime,
    this.toTime,
    this.badge,
    this.badgeColours,
    this.stamp,
    this.band,
    super.key,
  });

  final Destination destination;
  final String fromCity;
  final String toCity;

  /// The small caption above the amount, e.g. "Priya gets".
  final String label;
  final int amountMinor;
  final String? fromTime;
  final String? toTime;

  /// A status badge on the stub (e.g. "On its way").
  final String? badge;
  final (Color, Color)? badgeColours;

  /// A stamp across the stub (e.g. "Delivered 28 Sep").
  final String? stamp;

  /// The colour of the ticket's top. Blue until the money moves, amber on its
  /// way, green when paid, red if refused.
  final Color? band;

  @override
  Widget build(BuildContext context) {
    final d = destination;
    return LayoutBuilder(
      builder: (context, box) {
        return PhysicalShape(
          clipper: _TicketClipper(topHeight: _band),
          color: DemoColours.white,
          elevation: 1.5,
          shadowColor: Colors.black26,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                height: _band,
                width: double.infinity,
                color: band ?? d.colour,
                padding: const EdgeInsets.fromLTRB(18, 14, 18, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text('GBP', style: _route(d.onColour)),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 10),
                          child: Icon(
                            Icons.flight_takeoff,
                            color: d.onColour,
                            size: 20,
                          ),
                        ),
                        Text(d.currency, style: _route(d.onColour)),
                      ],
                    ),
                    const Spacer(),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        _city(fromCity, fromTime, d.onColour),
                        _city(toCity, toTime, d.onColour, end: true),
                      ],
                    ),
                  ],
                ),
              ),
              // The perforation.
              SizedBox(
                height: 18,
                child: CustomPaint(
                  painter: _PerforationPainter(),
                  size: const Size(double.infinity, 18),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 0, 18, 16),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            label,
                            style: const TextStyle(
                              color: DemoColours.ink2,
                              fontSize: 13,
                            ),
                          ),
                          FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerLeft,
                            child: Text(
                              foreign(d, amountMinor),
                              key: const Key('ticket_amount'),
                              style: DemoText.display.copyWith(fontSize: 38),
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (badge != null)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 5,
                        ),
                        decoration: BoxDecoration(
                          color: badgeColours?.$1 ?? DemoColours.fog,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          badge!,
                          style: TextStyle(
                            color: badgeColours?.$2 ?? DemoColours.ink,
                            fontWeight: FontWeight.w600,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    if (stamp != null)
                      Transform.rotate(
                        angle: -0.12,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            border: Border.all(color: DemoColours.ok, width: 2),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            stamp!.toUpperCase(),
                            style: const TextStyle(
                              color: DemoColours.ok,
                              fontWeight: FontWeight.w900,
                              fontSize: 12,
                              letterSpacing: 1,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  TextStyle _route(Color c) =>
      DemoText.display.copyWith(fontSize: 26, color: c);

  Widget _city(String city, String? time, Color c, {bool end = false}) {
    return Column(
      crossAxisAlignment: end
          ? CrossAxisAlignment.end
          : CrossAxisAlignment.start,
      children: [
        Text(
          city,
          style: TextStyle(color: c, fontWeight: FontWeight.w600, fontSize: 13),
        ),
        if (time != null)
          Text(time, style: DemoText.display.copyWith(fontSize: 18, color: c)),
      ],
    );
  }
}

class _TicketClipper extends CustomClipper<Path> {
  _TicketClipper({required this.topHeight});
  final double topHeight;

  @override
  Path getClip(Size size) {
    const r = 14.0;
    final notchY = topHeight + 9;
    final base = Path()
      ..addRRect(
        RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(16)),
      );
    final notches = Path()
      ..addOval(Rect.fromCircle(center: Offset(0, notchY), radius: r / 1.4))
      ..addOval(
        Rect.fromCircle(center: Offset(size.width, notchY), radius: r / 1.4),
      );
    return Path.combine(PathOperation.difference, base, notches);
  }

  @override
  bool shouldReclip(covariant _TicketClipper old) => old.topHeight != topHeight;
}

class _PerforationPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = DemoColours.line
      ..strokeWidth = 1.5;
    for (var x = 14.0; x < size.width - 14; x += 9) {
      canvas.drawLine(
        Offset(x, size.height / 2),
        Offset(x + 4, size.height / 2),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter old) => false;
}
