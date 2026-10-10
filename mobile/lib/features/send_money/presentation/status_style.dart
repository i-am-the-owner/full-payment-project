import 'package:flutter/material.dart';

import '../../../shared/theme/almapay_theme.dart';
import '../domain/models.dart';

/// The ticket colour for a status: blue until the money moves, amber on its
/// way, green when paid, red if it did not go through.
Color statusBand(TransferStatus s) => switch (s) {
  TransferStatus.completed => AlmaPayColours.paid,
  TransferStatus.failed ||
  TransferStatus.cancelled ||
  TransferStatus.refunded => AlmaPayColours.refused,
  TransferStatus.processing || TransferStatus.sent => AlmaPayColours.way,
  _ => AlmaPayColours.blue,
};

/// Readable text on [statusBand]: dark on amber, white on the rest.
Color onStatusBand(TransferStatus s) => statusBand(s) == AlmaPayColours.way
    ? AlmaPayColours.ink
    : AlmaPayColours.white;

/// `10 Oct`, the short date on a ticket.
String formatDate(DateTime value) {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  final local = value.toLocal();
  return '${local.day} ${months[local.month - 1]}';
}

/// The short wording on a ticket's badge: "On its way", "Delivered".
String badgeText(TransferStatus s) => switch (s) {
  TransferStatus.draft => 'Preparing',
  TransferStatus.awaitingFunds => 'Awaiting payment',
  TransferStatus.processing || TransferStatus.sent => 'On its way',
  TransferStatus.completed => 'Delivered',
  TransferStatus.cancelled => 'Cancelled',
  TransferStatus.refunded => 'Returned',
  TransferStatus.failed => 'Returned',
  TransferStatus.unknown => 'Checking',
};
