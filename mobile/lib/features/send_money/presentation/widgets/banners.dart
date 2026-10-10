import 'package:flutter/material.dart';

import '../../../../shared/theme/almapay_theme.dart';

/// A message box: an error, or something the customer should know. Screen
/// readers announce it when it appears.
class MessageBanner extends StatelessWidget {
  const MessageBanner({required this.text, this.isError = false, super.key});

  final String text;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: isError ? AlmaPayColours.badSoft : context.palette.accentSoft,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          text,
          style: AlmaPayText.ui(
            size: 14.5,
            weight: 500,
            color: isError ? AlmaPayColours.bad : context.palette.text,
          ),
        ),
      ),
    );
  }
}

/// A heading that screen readers treat as one, in the display face and capitals.
class StepHeading extends StatelessWidget {
  const StepHeading(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Semantics(
      header: true,
      child: Text(
        text.toUpperCase(),
        style: AlmaPayText.display.copyWith(fontSize: 38, height: .95),
      ),
    ),
  );
}

/// The main action of a screen: a full-width dark blue pill.
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({
    required this.label,
    required this.onPressed,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => FilledButton(
    onPressed: onPressed,
    child: Text(label, textAlign: TextAlign.center),
  );
}

/// A white pill with a hairline outline.
class SecondaryButton extends StatelessWidget {
  const SecondaryButton({
    required this.label,
    required this.onPressed,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => OutlinedButton(
    onPressed: onPressed,
    child: Text(label, textAlign: TextAlign.center),
  );
}

/// A white rounded panel holding rows separated by hairlines.
class Panel extends StatelessWidget {
  const Panel({required this.children, this.color, super.key});

  final List<Widget> children;
  final Color? color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 4),
    decoration: BoxDecoration(
      color: color ?? context.palette.surface,
      borderRadius: BorderRadius.circular(24),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) const Divider(),
          children[i],
        ],
      ],
    ),
  );
}
