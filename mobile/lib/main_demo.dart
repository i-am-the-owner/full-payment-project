import 'package:flutter/material.dart';

import 'app/environment/app_environment.dart';
import 'demo/demo_app.dart';

/// Entry point of the DEMO build: sample data, no backend, no network.
///
///   flutter build apk --release -t lib/main_demo.dart \
///     --dart-define=ALMAPAY_ENV=demo --dart-define=ALMAPAY_DEMO_RELEASE=true
///
/// The real app's entry point (`lib/main.dart`) never imports this file or
/// anything under `lib/demo`, so a production build cannot contain the demo.
void main() {
  // Refuses anything but ALMAPAY_ENV=demo, and a release build without the
  // demo workflows' extra flag.
  AppEnvironment.resolveDemo();
  runApp(const DemoApp());
}
