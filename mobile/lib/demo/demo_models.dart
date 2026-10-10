import 'package:flutter/material.dart';

/// Everything in `lib/demo` is SAMPLE DATA for a build with no backend. Nothing
/// here talks to a network, a bank or a payment provider.

/// A destination country, with its colour (AaminPay: blue is your side, green is
/// theirs; a ticket changes colour with its status), currency and the offset of its clocks.
class Destination {
  const Destination({
    required this.code,
    required this.country,
    required this.currency,
    required this.symbol,
    required this.colour,
    required this.soft,
    required this.onColour,
    required this.utcOffsetMinutes,
    required this.rateTimes10000,
  });

  /// ISO country code.
  final String code;
  final String country;

  /// ISO currency code, e.g. `INR`.
  final String currency;

  /// The symbol written before amounts, e.g. `₹`, `MX$`, `GH₵`.
  final String symbol;
  final Color colour;
  final Color soft;

  /// Readable text colour on [colour].
  final Color onColour;
  final int utcOffsetMinutes;

  /// Units of [currency] per £1, times 10,000 (an integer: no floating point money).
  final int rateTimes10000;

  /// `112.4630`, the rate as shown to the customer.
  String get rateText {
    final whole = rateTimes10000 ~/ 10000;
    final frac = (rateTimes10000 % 10000).toString().padLeft(4, '0');
    return '$whole.$frac';
  }
}

const Destination india = Destination(
  code: 'IN',
  country: 'India',
  currency: 'INR',
  symbol: '₹',
  colour: Color(0xFF2563D9),
  soft: Color(0xFFE6EEFC),
  onColour: Color(0xFFFFFFFF),
  utcOffsetMinutes: 330,
  rateTimes10000: 1124630,
);

const Destination mexico = Destination(
  code: 'MX',
  country: 'Mexico',
  currency: 'MXN',
  symbol: 'MX\$',
  colour: Color(0xFF2563D9),
  soft: Color(0xFFE6EEFC),
  onColour: Color(0xFFFFFFFF),
  utcOffsetMinutes: -360,
  rateTimes10000: 233401,
);

const Destination ghana = Destination(
  code: 'GH',
  country: 'Ghana',
  currency: 'GHS',
  symbol: 'GH₵',
  colour: Color(0xFF2563D9),
  soft: Color(0xFFE6EEFC),
  onColour: Color(0xFFFFFFFF),
  utcOffsetMinutes: 0,
  rateTimes10000: 180700,
);

const List<Destination> destinations = [india, mexico, ghana];

/// Someone the customer sends money to.
class Person {
  const Person({
    required this.id,
    required this.name,
    required this.city,
    required this.destination,
    required this.bank,
    required this.accountTail,
  });

  final String id;
  final String name;
  final String city;
  final Destination destination;
  final String bank;

  /// Only the last four digits are ever kept or shown.
  final String accountTail;

  String get firstName => name.split(' ').first;

  String get initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    final letters = parts.length == 1
        ? parts.first.characters.take(2)
        : [parts.first.characters.first, parts.last.characters.first];
    return letters.join().toUpperCase();
  }

  String get bankLine => '$bank ending $accountTail';
}

enum DemoStatus {
  awaitingPayment,
  paymentReceived,
  converting,
  delivered,
  returning,
  returned;

  bool get isFinal => this == delivered || this == returned;

  /// The label on the badge in lists.
  String get badge => switch (this) {
    awaitingPayment => 'Waiting for you',
    paymentReceived || converting => 'On its way',
    delivered => 'Delivered',
    returning => 'Coming back',
    returned => 'Returned',
  };
}

/// When a transfer reached a status (UTC).
class TransferEvent {
  const TransferEvent(this.status, this.at);
  final DemoStatus status;
  final DateTime at;
}

/// One transfer, drawn as a ticket.
class DemoTransfer {
  DemoTransfer({
    required this.id,
    required this.person,
    required this.sendPence,
    required this.feePence,
    required this.receiveMinor,
    required this.reference,
    required this.createdAt,
    required this.dateLabel,
    required this.status,
    List<TransferEvent>? events,
    this.rejectedReason,
  }) : events = events ?? [TransferEvent(status, createdAt)];

  final String id;
  final Person person;

  /// The timeline: each status with the time it was reached.
  final List<TransferEvent> events;

  /// What the customer pays, in pence (our fee is included).
  final int sendPence;
  final int feePence;

  /// What the recipient gets, in minor units of the destination currency.
  final int receiveMinor;
  final String reference;
  final DateTime createdAt;

  /// `3 Oct`, as written on the ticket.
  final String dateLabel;
  DemoStatus status;

  /// Set when the recipient's bank rejected the payment.
  String? rejectedReason;

  /// What the customer pays. Our fee is INSIDE it: the recipient gets the rest, at the rate.
  int get totalPence => sendPence;
}
