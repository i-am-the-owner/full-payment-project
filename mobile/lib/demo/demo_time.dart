import 'demo_models.dart';

/// Clock times in two cities without a time-zone database: a fixed UTC offset.
/// (The UK is shown on British Summer Time, UTC+1.)
const int ukOffsetMinutes = 60;

String clock(DateTime nowUtc, int offsetMinutes) {
  final t = nowUtc.add(Duration(minutes: offsetMinutes));
  return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
}

String ukClock(DateTime nowUtc) => clock(nowUtc, ukOffsetMinutes);
String localClock(DateTime nowUtc, Destination d) =>
    clock(nowUtc, d.utcOffsetMinutes);

/// When it lands, in the recipient's own time (the demo promises two hours).
String arrivalBy(DateTime nowUtc, Destination d) =>
    localClock(nowUtc.add(const Duration(hours: 2)), d);

const _months = [
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

/// `4 Oct`.
String dayMonth(DateTime t) => '${t.day} ${_months[t.month - 1]}';
