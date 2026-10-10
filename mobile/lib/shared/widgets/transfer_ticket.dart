import 'package:flutter/material.dart';

import '../theme/almapay_theme.dart';
import 'aamin_ticket.dart';

/// A transfer drawn as a ticket between two currencies, with a tear-off stub for
/// the amount. Purely presentational: every string is passed in already
/// formatted (the backend's amounts are shown verbatim and never recomputed
/// here), and the band colour is chosen by the caller, so no country or
/// provider is hard-coded.
///
/// [compact] draws the small ticket used in lists: a slim top with the route and
/// a date, and a stub with the person, the amount and a status badge.
class TransferTicket extends StatelessWidget {
  const TransferTicket({
    required this.fromCurrency,
    required this.toCurrency,
    required this.label,
    required this.amount,
    this.fromCaption,
    this.toCaption,
    this.badge,
    this.badgeColours,
    this.bandColour = AlmaPayColours.blue,
    this.onBandColour = AlmaPayColours.white,
    this.compact = false,
    this.stamp,
    this.detail,
    this.onTap,
    super.key,
  });

  final String fromCurrency;
  final String toCurrency;

  /// Small caption above the amount, e.g. "Recipient gets".
  final String label;

  /// The amount as the backend formatted it, e.g. "112.46 INR".
  final String amount;
  final String? fromCaption;
  final String? toCaption;

  /// A status chip on the stub and its (background, text) colours.
  final String? badge;
  final (Color, Color)? badgeColours;
  final Color bandColour;
  final Color onBandColour;
  final bool compact;

  /// A rubber stamp across the stub, e.g. "Delivered 10 Oct".
  final String? stamp;

  /// A small line under the badge on a compact ticket, e.g. "You paid £22.00".
  final String? detail;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    if (compact) return _mini(context);
    return AaminTicket(
      band: bandColour,
      onBand: onBandColour,
      onTap: onTap,
      top: TicketRoute(
        from: fromCurrency,
        to: toCurrency,
        fromCaption: fromCaption,
        toCaption: toCaption,
      ),
      stub: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(child: _amountBlock(context, size: 40)),
          if (stamp != null) _Stamp(stamp!),
          if (badge != null)
            Flexible(child: StatusBadge(badge!, colours: badgeColours)),
        ],
      ),
    );
  }

  Widget _mini(BuildContext context) {
    final code = AlmaPayText.display.copyWith(
      fontSize: 19,
      height: 1,
      color: onBandColour,
    );
    return AaminTicket(
      band: bandColour,
      onBand: onBandColour,
      onTap: onTap,
      topHeight: 32,
      topPadding: const EdgeInsets.symmetric(horizontal: 16),
      stubPadding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
      top: LayoutBuilder(
        builder: (context, box) => Row(
          children: [
            ConstrainedBox(
              constraints: BoxConstraints(maxWidth: box.maxWidth * .6),
              child: FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(fromCurrency, style: code),
                    const SizedBox(width: 8),
                    Icon(Icons.arrow_right_alt, size: 20, color: onBandColour),
                    const SizedBox(width: 8),
                    Text(toCurrency, style: code),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                fromCaption ?? '',
                textAlign: TextAlign.end,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AlmaPayText.ui(
                  size: 12.5,
                  weight: 600,
                  color: onBandColour,
                ),
              ),
            ),
          ],
        ),
      ),
      stub: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(child: _amountBlock(context, size: 23)),
          if (badge != null)
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  StatusBadge(badge!, colours: badgeColours),
                  if (detail != null) ...[
                    const SizedBox(height: 3),
                    Text(
                      detail!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AlmaPayText.ui(
                        size: 12.5,
                        color: context.palette.muted,
                      ),
                    ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _amountBlock(BuildContext context, {required double size}) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        compact ? (toCaption ?? label) : label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AlmaPayText.ui(
          // On a list ticket the caption is the person's name: make it easy to read.
          size: compact ? 16 : 13,
          weight: compact ? 700 : 500,
          color: compact ? context.palette.text : context.palette.muted,
        ),
      ),
      FittedBox(
        fit: BoxFit.scaleDown,
        alignment: Alignment.centerLeft,
        child: Text(
          amount,
          style: AlmaPayText.display.copyWith(fontSize: size),
        ),
      ),
    ],
  );
}

/// A status pill with a leading dot, as in the design: "On its way",
/// "Delivered", "Returned".
class StatusBadge extends StatelessWidget {
  const StatusBadge(this.text, {this.colours, super.key});

  final String text;
  final (Color, Color)? colours;

  @override
  Widget build(BuildContext context) {
    final bg = colours?.$1 ?? context.palette.background;
    final fg = colours?.$2 ?? context.palette.text;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: fg, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AlmaPayText.ui(size: 13, weight: 600, color: fg),
            ),
          ),
        ],
      ),
    );
  }
}

/// The "Delivered" stamp: a tilted green ring with the date.
class _Stamp extends StatelessWidget {
  const _Stamp(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    final words = text.toUpperCase().split(' ');
    return Transform.rotate(
      angle: -0.24,
      child: Container(
        width: 96,
        height: 96,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: AlmaPayColours.ok, width: 3),
        ),
        child: Text(
          words.length > 1
              ? '${words.first}\n${words.sublist(1).join(' ')}'
              : words.first,
          textAlign: TextAlign.center,
          style: AlmaPayText.display.copyWith(
            fontSize: 20,
            height: .95,
            color: AlmaPayColours.ok,
          ),
        ),
      ),
    );
  }
}
