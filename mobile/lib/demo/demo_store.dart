import 'dart:async';

import 'package:flutter/foundation.dart';

import 'demo_models.dart';
import 'demo_money.dart';
import 'demo_time.dart';

const Person priya = Person(
  id: 'priya',
  name: 'Priya Sharma',
  city: 'Bengaluru',
  destination: india,
  bank: 'HDFC',
  accountTail: '4821',
);
const Person rahul = Person(
  id: 'rahul',
  name: 'Rahul Kapoor',
  city: 'Pune',
  destination: india,
  bank: 'SBI',
  accountTail: '0093',
);
const Person juan = Person(
  id: 'juan',
  name: 'Juan Pérez',
  city: 'Guadalajara',
  destination: mexico,
  bank: 'BBVA',
  accountTail: '7710',
);
const Person ama = Person(
  id: 'ama',
  name: 'Ama Mensah',
  city: 'Accra',
  destination: ghana,
  bank: 'GCB',
  accountTail: '3302',
);

/// The partner every payment goes to. Sample data: never a real company or account.
const String partnerName = 'Example Partner Ltd';
const String partnerSortCode = '12-34-56';
const String partnerAccount = '87654321';

/// Limit shown on the account screen, and enforced when typing an amount.
const int maxSendPence = 500000;
const int minSendPence = 100;

/// The demo's whole state, in memory. Nothing is saved, sent or stored anywhere;
/// closing the app (or "Reset demo") starts again from the sample data.
class DemoStore extends ChangeNotifier {
  DemoStore({DateTime Function()? now, this.step = const Duration(seconds: 4)})
    : _now = now ?? DateTime.now {
    _seed();
  }

  /// How often an in-flight transfer moves to its next status.
  final Duration step;
  final DateTime Function() _now;

  bool signedIn = false;
  String userName = 'Sara';
  String email = 'sara@example.com';
  final List<Person> people = [];
  final List<DemoTransfer> transfers = [];
  Timer? _timer;
  int _counter = 0;

  DateTime get nowUtc => _now().toUtc();

  void _seed() {
    people
      ..clear()
      ..addAll([priya, juan, ama, rahul]);
    final t = DateTime.utc(2026, 10, 3, 8, 12);
    transfers
      ..clear()
      ..addAll([
        _seedTransfer(
          person: priya,
          sendPence: 50000,
          reference: 'P38291745',
          at: t,
          label: '3 Oct',
          // Waiting for the customer's payment: "Pay now" on the home screen.
          status: DemoStatus.awaitingPayment,
          path: const [DemoStatus.awaitingPayment],
        ),
        _seedTransfer(
          person: juan,
          sendPence: 20000,
          reference: 'P37902218',
          at: DateTime.utc(2026, 9, 28, 9, 5),
          label: '28 Sep',
          status: DemoStatus.delivered,
          path: const [
            DemoStatus.awaitingPayment,
            DemoStatus.paymentReceived,
            DemoStatus.converting,
            DemoStatus.delivered,
          ],
        ),
        _seedTransfer(
          person: ama,
          sendPence: 15000,
          reference: 'P36118840',
          at: DateTime.utc(2026, 9, 19, 14, 20),
          label: '19 Sep',
          status: DemoStatus.returned,
          path: const [
            DemoStatus.awaitingPayment,
            DemoStatus.paymentReceived,
            DemoStatus.converting,
            DemoStatus.returning,
            DemoStatus.returned,
          ],
          receiveMinor: 271050,
          reason:
              "Ama's bank rejected the payment because the account number "
              "didn't match her name.",
        ),
      ]);
  }

  DemoTransfer _seedTransfer({
    required Person person,
    required int sendPence,
    required String reference,
    required DateTime at,
    required String label,
    required DemoStatus status,
    required List<DemoStatus> path,
    String? reason,
    int? receiveMinor,
  }) {
    final fee = feeFor(sendPence);
    return DemoTransfer(
      id: 't-$reference',
      person: person,
      sendPence: sendPence,
      feePence: fee,
      // The design reference's sample amount, where it is not exactly what the fee rule gives.
      receiveMinor: receiveMinor ?? receiveFor(person.destination, sendPence),
      reference: reference,
      createdAt: at,
      dateLabel: label,
      status: status,
      rejectedReason: reason,
      events: [
        for (var i = 0; i < path.length; i++)
          TransferEvent(path[i], at.add(Duration(minutes: 19 * i))),
      ],
    );
  }

  // --- Account -----------------------------------------------------------

  /// Any name and email are accepted, and so is any code.
  void signUp({required String name, required String emailAddress}) {
    userName = name.trim().isEmpty ? 'Sara' : name.trim().split(' ').first;
    email = emailAddress.trim().isEmpty
        ? 'sara@example.com'
        : emailAddress.trim();
    signedIn = true;
    notifyListeners();
  }

  void signOut() {
    signedIn = false;
    notifyListeners();
  }

  /// Back to the sample data, signed out.
  void reset() {
    _timer?.cancel();
    _timer = null;
    _counter = 0;
    signedIn = false;
    userName = 'Sara';
    email = 'sara@example.com';
    _seed();
    notifyListeners();
  }

  // --- People ----------------------------------------------------------------

  Person addPerson({
    required String name,
    required String city,
    required Destination destination,
    required String bank,
    required String accountNumber,
  }) {
    final digits = accountNumber.replaceAll(RegExp(r'\D'), '');
    final person = Person(
      id: 'p${people.length + 1}-${name.hashCode}',
      name: name.trim(),
      city: city.trim().isEmpty ? destination.country : city.trim(),
      destination: destination,
      bank: bank.trim().isEmpty ? 'Bank' : bank.trim(),
      // Only the last four digits are kept: the rest is dropped immediately.
      accountTail: digits.length >= 4
          ? digits.substring(digits.length - 4)
          : digits.padLeft(4, '0'),
    );
    people.insert(0, person);
    notifyListeners();
    return person;
  }

  // --- Transfers ---------------------------------------------------------

  DemoTransfer? get latestOpen {
    for (final t in transfers) {
      if (!t.status.isFinal) return t;
    }
    return null;
  }

  /// A ticket waiting for the customer's payment.
  DemoTransfer createTransfer(Person person, int sendPence) {
    _counter += 1;
    final now = nowUtc;
    final t = DemoTransfer(
      id: 'new-$_counter',
      person: person,
      sendPence: sendPence,
      feePence: feeFor(sendPence),
      receiveMinor: receiveFor(person.destination, sendPence),
      reference: 'P${(38400000 + _counter * 137).toString()}',
      createdAt: now,
      dateLabel: dayMonth(now),
      status: DemoStatus.awaitingPayment,
    );
    transfers.insert(0, t);
    notifyListeners();
    return t;
  }

  /// "I've paid": the sample partner "receives" the money and the transfer starts to move.
  void markPaid(DemoTransfer t) {
    if (t.status != DemoStatus.awaitingPayment) return;
    _advance(t, DemoStatus.paymentReceived);
    _ensureTimer();
  }

  /// Demo only: the recipient's bank rejects the payment, to show the money coming back.
  bool simulateBankRejection(DemoTransfer t) {
    if (t.status != DemoStatus.paymentReceived &&
        t.status != DemoStatus.converting) {
      return false;
    }
    t.rejectedReason =
        "${t.person.firstName}'s bank rejected the payment because the account "
        "number didn't match ${t.person.firstName == 'Ama' ? 'her' : 'their'} name.";
    _advance(t, DemoStatus.returning);
    _ensureTimer();
    return true;
  }

  void _advance(DemoTransfer t, DemoStatus next) {
    t.status = next;
    t.events.add(TransferEvent(next, nowUtc));
    notifyListeners();
  }

  void _ensureTimer() {
    _timer ??= Timer.periodic(step, (_) => _tick());
  }

  void _tick() {
    var anyOpen = false;
    for (final t in transfers) {
      final next = switch (t.status) {
        DemoStatus.paymentReceived => DemoStatus.converting,
        DemoStatus.converting => DemoStatus.delivered,
        DemoStatus.returning => DemoStatus.returned,
        _ => null,
      };
      if (next != null) _advance(t, next);
      // A transfer waiting for payment does not move by itself.
      if (!t.status.isFinal && t.status != DemoStatus.awaitingPayment) {
        anyOpen = true;
      }
    }
    if (!anyOpen) {
      _timer?.cancel();
      _timer = null;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
