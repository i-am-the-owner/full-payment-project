import 'package:flutter/material.dart';

import '../../../../shared/theme/almapay_theme.dart';
import '../../domain/models.dart';

/// A button showing the chosen currency; tapping it opens a searchable list
/// of the currencies the provider supports. Nothing in the list is hard-coded.
class CurrencyPickerButton extends StatelessWidget {
  const CurrencyPickerButton({
    required this.label,
    required this.selected,
    required this.codes,
    required this.currencies,
    required this.onSelected,
    this.onColour = AlmaPayColours.white,
    super.key,
  });

  /// Read out by screen readers, e.g. "Currency you send".
  final String label;
  final String? selected;
  final List<String> codes;
  final SupportedCurrencies? currencies;
  final ValueChanged<String> onSelected;

  /// The colour of the code and arrow: white on a coloured ticket top.
  final Color onColour;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: '$label: ${selected ?? 'not chosen'}. Tap to change',
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: codes.isEmpty
            ? null
            : () async {
                final picked = await showModalBottomSheet<String>(
                  context: context,
                  isScrollControlled: true,
                  showDragHandle: true,
                  builder: (_) => _CurrencySheet(
                    title: label,
                    codes: codes,
                    currencies: currencies,
                  ),
                );
                if (picked != null) onSelected(picked);
              },
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48, minWidth: 48),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                selected ?? '—',
                style: AlmaPayText.ui(size: 15, weight: 700, color: onColour),
              ),
              Icon(Icons.keyboard_arrow_down, color: onColour, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

class _CurrencySheet extends StatefulWidget {
  const _CurrencySheet({
    required this.title,
    required this.codes,
    required this.currencies,
  });

  final String title;
  final List<String> codes;
  final SupportedCurrencies? currencies;

  @override
  State<_CurrencySheet> createState() => _CurrencySheetState();
}

class _CurrencySheetState extends State<_CurrencySheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final query = _query.trim().toLowerCase();
    final matches = widget.codes
        .where((code) {
          final name = widget.currencies?.info(code)?.name ?? '';
          return query.isEmpty ||
              code.toLowerCase().contains(query) ||
              name.toLowerCase().contains(query);
        })
        .toList(growable: false);

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
        ),
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.6,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(
                header: true,
                child: Text(
                  widget.title,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('currency_search'),
                autofocus: false,
                decoration: const InputDecoration(
                  labelText: 'Search currencies',
                  prefixIcon: Icon(Icons.search),
                ),
                onChanged: (value) => setState(() => _query = value),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: matches.isEmpty
                    ? const Center(child: Text('No currency matches'))
                    : ListView.builder(
                        itemCount: matches.length,
                        itemBuilder: (context, index) {
                          final code = matches[index];
                          final name = widget.currencies?.info(code)?.name;
                          return ListTile(
                            key: Key('currency_option_$code'),
                            title: Text(code),
                            subtitle: name == null || name == code
                                ? null
                                : Text(name),
                            onTap: () => Navigator.of(context).pop(code),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
