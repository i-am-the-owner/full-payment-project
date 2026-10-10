import 'package:flutter/material.dart';

import '../theme/almapay_theme.dart';
import 'aamin_ticket.dart';

/// The ticket on the signed-out screens: blue for what you send, green for what
/// they get. Illustration only: the wording is generic, with no rates,
/// countries or sample transfers.
class WelcomeTickets extends StatelessWidget {
  const WelcomeTickets({super.key});

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: AaminTicket(
        topHeight: 66,
        topPadding: EdgeInsets.zero,
        stubPadding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
        bandGradient: AaminTicket.split,
        top: Row(
          children: [
            _half('You send', Alignment.centerLeft),
            _half('They receive', Alignment.centerRight),
          ],
        ),
        stub: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Before you pay',
                    style: AlmaPayText.ui(
                      size: 13,
                      weight: 500,
                      color: AlmaPayColours.ink2,
                    ),
                  ),
                  Text(
                    'Exact price',
                    style: AlmaPayText.display.copyWith(fontSize: 34),
                  ),
                ],
              ),
            ),
            Text(
              'Tracked to the door',
              style: AlmaPayText.ui(
                size: 13,
                weight: 500,
                color: AlmaPayColours.ink2,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _half(String text, Alignment a) => Expanded(
    child: Align(
      alignment: a,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Text(
          text,
          style: AlmaPayText.display.copyWith(
            fontSize: 28,
            color: AlmaPayColours.white,
          ),
        ),
      ),
    ),
  );
}
