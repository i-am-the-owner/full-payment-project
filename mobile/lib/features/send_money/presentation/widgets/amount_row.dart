import 'package:flutter/material.dart';

import '../../../../shared/theme/almapay_theme.dart';
import '../../domain/models.dart';
import 'banners.dart' show Panel;
import 'transfer_timeline.dart' show formatDateTime;

/// One `label … value` line in a money breakdown, as in the design: grey label,
/// bold value. The value wraps rather than overflowing on a narrow phone.
class AmountRow extends StatelessWidget {
  const AmountRow({
    required this.label,
    required this.value,
    this.emphasise = false,
    super.key,
  });

  final String label;
  final String value;
  final bool emphasise;

  @override
  Widget build(BuildContext context) {
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: LayoutBuilder(
          builder: (context, box) => Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ConstrainedBox(
                constraints: BoxConstraints(maxWidth: box.maxWidth * .55),
                child: Text(
                  label,
                  style: AlmaPayText.ui(
                    size: 15.5,
                    weight: emphasise ? 600 : 400,
                    color: emphasise
                        ? context.palette.text
                        : context.palette.muted,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  value,
                  textAlign: TextAlign.end,
                  style: AlmaPayText.ui(size: 15.5, weight: 600),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The provider's quote, shown verbatim. Nothing here is computed on the
/// client: every figure, with its decimal places, is the backend's string.
class QuoteBreakdown extends StatelessWidget {
  const QuoteBreakdown({required this.quote, this.showTotal = true, super.key});

  final Quote quote;

  /// Leave the total off where the screen shows it in its own bar.
  final bool showTotal;

  @override
  Widget build(BuildContext context) {
    return Panel(
      key: const Key('quote_breakdown'),
      children: [
        AmountRow(label: 'Our fee', value: quote.fee.label),
        AmountRow(
          label: 'Rate',
          value:
              '1 ${quote.source.currency} = ${quote.exchangeRate} ${quote.target.currency}',
        ),
        if (quote.estimatedDelivery != null)
          AmountRow(
            label: 'Should arrive by',
            value: formatDateTime(quote.estimatedDelivery!),
          ),
        if (showTotal)
          AmountRow(
            label: 'Total to pay',
            value: quote.totalToPay.label,
            emphasise: true,
          ),
      ],
    );
  }
}
