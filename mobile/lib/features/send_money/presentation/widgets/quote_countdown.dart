import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../shared/theme/almapay_theme.dart';
import '../../domain/models.dart';

/// Shows how long the quote's rate is still guaranteed, counting down each
/// second, and calls [onExpired] once when it runs out so the caller can fetch
/// a fresh quote.
class QuoteCountdown extends StatefulWidget {
  const QuoteCountdown({
    required this.quote,
    required this.onExpired,
    this.now = DateTime.now,
    super.key,
  });

  final Quote quote;
  final VoidCallback onExpired;

  /// The clock, replaceable in tests.
  final DateTime Function() now;

  @override
  State<QuoteCountdown> createState() => _QuoteCountdownState();
}

class _QuoteCountdownState extends State<QuoteCountdown> {
  Timer? _timer;
  bool _reported = false;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
    WidgetsBinding.instance.addPostFrameCallback((_) => _tick());
  }

  @override
  void didUpdateWidget(QuoteCountdown oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.quote.id != widget.quote.id) {
      _reported = false;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _tick() {
    if (!mounted) return;
    setState(() {});
    if (!_reported && widget.quote.secondsLeft(widget.now()) == 0) {
      _reported = true;
      widget.onExpired();
    }
  }

  @override
  Widget build(BuildContext context) {
    final seconds = widget.quote.secondsLeft(widget.now());
    final minutes = seconds ~/ 60;
    final rest = (seconds % 60).toString().padLeft(2, '0');
    final text = seconds == 0
        ? 'Getting the latest rate…'
        : 'Rate guaranteed for $minutes:$rest';
    return Semantics(
      // Announced as a duration, and not re-read every second.
      label: seconds == 0
          ? text
          : 'Rate guaranteed for $minutes minutes and ${seconds % 60} seconds',
      excludeSemantics: true,
      child: Row(
        key: const Key('quote_countdown'),
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.timer_outlined, size: 16, color: context.palette.muted),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              text,
              style: AlmaPayText.ui(size: 13.5, color: context.palette.muted),
            ),
          ),
        ],
      ),
    );
  }
}
