import 'package:flutter/material.dart';

import '../../features/send_money/domain/models.dart';
import '../theme/almapay_theme.dart';

/// A person: initials in a blue circle, name, and the masked account.
class PersonRow extends StatelessWidget {
  const PersonRow({required this.person, this.trailing, super.key});

  final Recipient person;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        children: [
          Avatar(person.displayName),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  person.displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AlmaPayText.ui(size: 16, weight: 600),
                ),
                Text(
                  '${person.accountSummary} · ${person.country}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AlmaPayText.ui(size: 14, color: context.palette.muted),
                ),
              ],
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

class Avatar extends StatelessWidget {
  const Avatar(this.name, {this.size = 46, super.key});
  final String name;
  final double size;

  String get _initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    final a = parts.first.isEmpty ? '' : parts.first[0];
    final b = parts.length > 1 ? parts.last[0] : '';
    return (a + b).toUpperCase();
  }

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: context.palette.accentSoft,
      shape: BoxShape.circle,
    ),
    child: ExcludeSemantics(
      child: Text(
        _initials,
        style: AlmaPayText.ui(size: size * .33, weight: 600),
      ),
    ),
  );
}
