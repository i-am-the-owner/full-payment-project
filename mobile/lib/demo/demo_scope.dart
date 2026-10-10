import 'package:flutter/widgets.dart';

import 'demo_store.dart';

/// Gives every demo screen the one [DemoStore], and rebuilds them when it changes.
class DemoScope extends InheritedNotifier<DemoStore> {
  const DemoScope({required DemoStore store, required super.child, super.key})
    : super(notifier: store);

  static DemoStore of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<DemoScope>();
    assert(scope != null, 'No DemoScope above this widget');
    return scope!.notifier!;
  }
}
