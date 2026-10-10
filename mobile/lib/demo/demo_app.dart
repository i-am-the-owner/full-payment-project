import 'package:flutter/material.dart';

import 'demo_scope.dart';
import 'demo_store.dart';
import 'demo_theme.dart';
import 'screens/shell.dart';
import 'screens/welcome.dart';

/// The label shown on every screen of the demo.
const String demoLabel = 'Demo – no real money';

/// The whole demo app: sample people, rates and transfers, no backend, no network.
class DemoApp extends StatefulWidget {
  const DemoApp({this.store, super.key});

  /// Replaced in tests (to control time and speed).
  final DemoStore? store;

  @override
  State<DemoApp> createState() => _DemoAppState();
}

class _DemoAppState extends State<DemoApp> {
  late final DemoStore _store = widget.store ?? DemoStore();

  @override
  void dispose() {
    if (widget.store == null) _store.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return DemoScope(
      store: _store,
      child: MaterialApp(
        title: 'AaminPay Demo',
        theme: demoTheme(),
        debugShowCheckedModeBanner: false,
        // The label sits OUTSIDE the navigator, so it is on every screen, including
        // ones pushed on top, and cannot be covered by a route.
        builder: (context, child) => Column(
          children: [
            const _DemoBanner(),
            Expanded(
              child: MediaQuery.removePadding(
                context: context,
                removeTop: true,
                child: child!,
              ),
            ),
          ],
        ),
        home: const _Gate(),
      ),
    );
  }
}

class _Gate extends StatelessWidget {
  const _Gate();

  @override
  Widget build(BuildContext context) {
    final store = DemoScope.of(context);
    return store.signedIn ? const DemoShell() : const WelcomePage();
  }
}

class _DemoBanner extends StatelessWidget {
  const _DemoBanner();

  @override
  Widget build(BuildContext context) {
    return Material(
      color: DemoColours.marigold,
      child: SafeArea(
        bottom: false,
        child: Container(
          key: const Key('demo_banner'),
          height: 24,
          alignment: Alignment.center,
          child: const Text(
            demoLabel,
            style: TextStyle(
              color: DemoColours.ink,
              fontSize: 12,
              fontWeight: FontWeight.w800,
              letterSpacing: .3,
            ),
          ),
        ),
      ),
    );
  }
}
