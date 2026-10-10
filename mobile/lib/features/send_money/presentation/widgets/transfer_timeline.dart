import 'package:flutter/material.dart';

import '../../../../shared/theme/almapay_theme.dart';
import '../../domain/models.dart';

/// The four steps every successful transfer goes through, in order.
const List<TransferStatus> _path = [
  TransferStatus.awaitingFunds,
  TransferStatus.processing,
  TransferStatus.sent,
  TransferStatus.completed,
];

String formatDateTime(DateTime value) {
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} '
      '${two(local.hour)}:${two(local.minute)}';
}

/// "Waiting for your money → Processing → Sent → Delivered", showing which
/// steps are done and when. Every status and time comes from the backend's
/// record of what the provider reported; the app decides nothing.
class TransferTimeline extends StatelessWidget {
  const TransferTimeline({required this.transfer, super.key});

  final Transfer transfer;

  @override
  Widget build(BuildContext context) {
    final status = transfer.status;
    final reached = _path.indexOf(status);
    final offPath =
        status == TransferStatus.cancelled ||
        status == TransferStatus.failed ||
        status == TransferStatus.refunded;
    // For a transfer that left the path, show how far it had got.
    final furthest = offPath
        ? transfer.timeline
              .map((e) => _path.indexOf(e.status))
              .fold(-1, (a, b) => b > a ? b : a)
        : reached;

    DateTime? when(TransferStatus step) => transfer.timeline
        .where((e) => e.status == step)
        .map((e) => e.occurredAt)
        .lastOrNull;

    return Column(
      key: const Key('transfer_timeline'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < _path.length; i++)
          _Step(
            label: _path[i].label,
            time: when(_path[i]),
            state: i < furthest || (i == furthest && status.isSettled)
                ? _StepState.done
                : i == furthest && !offPath
                ? _StepState.current
                : _StepState.upcoming,
            isLast: i == _path.length - 1 && !offPath,
          ),
        if (offPath)
          _Step(
            label: status.label,
            time: when(status),
            state: _StepState.stopped,
            isLast: true,
          ),
      ],
    );
  }
}

enum _StepState { done, current, upcoming, stopped }

class _Step extends StatelessWidget {
  const _Step({
    required this.label,
    required this.time,
    required this.state,
    required this.isLast,
  });

  final String label;
  final DateTime? time;
  final _StepState state;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final spoken = switch (state) {
      _StepState.done => 'done',
      _StepState.current => 'in progress',
      _StepState.upcoming => 'not yet',
      _StepState.stopped => '',
    };
    final timeText = time == null ? null : formatDateTime(time!);
    final muted = state == _StepState.upcoming;
    return Semantics(
      label: [label, spoken, ?timeText].where((s) => s.isNotEmpty).join(', '),
      excludeSemantics: true,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: 28,
              child: Column(
                children: [
                  _dot(),
                  if (!isLast)
                    Expanded(
                      child: Container(
                        width: 2,
                        color: state == _StepState.done
                            ? AlmaPayColours.ink
                            : AlmaPayColours.line,
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Padding(
                padding: EdgeInsets.only(bottom: isLast ? 0 : 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: AlmaPayText.ui(
                        size: 16,
                        weight: 600,
                        color: muted
                            ? AlmaPayColours.faint
                            : state == _StepState.stopped
                            ? AlmaPayColours.refused
                            : AlmaPayColours.ink,
                      ),
                    ),
                    if (timeText != null)
                      Text(
                        timeText,
                        style: AlmaPayText.ui(
                          size: 13.5,
                          color: AlmaPayColours.ink2,
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _dot() {
    switch (state) {
      case _StepState.done:
        return Container(
          width: 28,
          height: 28,
          decoration: const BoxDecoration(
            color: AlmaPayColours.ink,
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.check, size: 16, color: Colors.white),
        );
      case _StepState.current:
        return Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: Colors.white,
            border: Border.all(color: AlmaPayColours.ink, width: 2),
          ),
          child: Center(
            child: Container(
              width: 10,
              height: 10,
              decoration: const BoxDecoration(
                color: AlmaPayColours.ink,
                shape: BoxShape.circle,
              ),
            ),
          ),
        );
      case _StepState.upcoming:
        return Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: Colors.white,
            border: Border.all(color: AlmaPayColours.line, width: 2),
          ),
        );
      case _StepState.stopped:
        return Container(
          width: 28,
          height: 28,
          decoration: const BoxDecoration(
            color: AlmaPayColours.refused,
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.close, size: 16, color: Colors.white),
        );
    }
  }
}
