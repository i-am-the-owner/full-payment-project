import 'package:almapay/features/security/biometric_lock.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _Auth implements BiometricAuthenticator {
  _Auth({this.available = true, this.passes = true});
  bool available;
  bool passes;
  @override
  Future<bool> isAvailable() async => available;
  @override
  Future<bool> authenticate(String reason) async => passes;
}

class _Store implements BiometricPreferenceStore {
  _Store(this.value);
  bool value;
  @override
  Future<bool> read() async => value;
  @override
  Future<void> write(bool enabled) async => value = enabled;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('starts locked when the saved choice is on', () async {
    final c = BiometricLockController(
      authenticator: _Auth(),
      store: _Store(true),
    );
    await c.init();
    expect(c.locked, isTrue);
    expect(await c.unlock(), isTrue);
    expect(c.locked, isFalse);
    c.dispose();
  });

  test('a failed check stays locked', () async {
    final c = BiometricLockController(
      authenticator: _Auth(passes: false),
      store: _Store(true),
    );
    await c.init();
    expect(await c.unlock(), isFalse);
    expect(c.locked, isTrue);
    c.dispose();
  });

  test('cannot be turned on without a successful check or a sensor', () async {
    final noSensor = BiometricLockController(
      authenticator: _Auth(available: false),
      store: _Store(false),
    );
    await noSensor.init();
    expect(await noSensor.setEnabled(true), isFalse);
    expect(noSensor.enabled, isFalse);

    final store = _Store(false);
    final failing = BiometricLockController(
      authenticator: _Auth(passes: false),
      store: store,
    );
    await failing.init();
    expect(await failing.setEnabled(true), isFalse);
    expect(store.value, isFalse);
    noSensor.dispose();
    failing.dispose();
  });

  test('turning on is saved; reset on sign-out clears it', () async {
    final store = _Store(false);
    final c = BiometricLockController(authenticator: _Auth(), store: store);
    await c.init();
    expect(await c.setEnabled(true), isTrue);
    expect(store.value, isTrue);
    await c.reset();
    expect(store.value, isFalse);
    expect(c.enabled, isFalse);
    c.dispose();
  });

  testWidgets('the gate hides the app until unlocked', (tester) async {
    final auth = _Auth(passes: false);
    final c = BiometricLockController(authenticator: auth, store: _Store(true));
    await c.init();
    await tester.pumpWidget(
      MaterialApp(
        home: BiometricLockGate(controller: c, child: const Text('secret')),
      ),
    );
    await tester.pump();
    expect(find.text('secret'), findsNothing);
    expect(find.byKey(const Key('biometric_unlock')), findsOneWidget);
    auth.passes = true;
    await tester.tap(find.byKey(const Key('biometric_unlock')));
    await tester.pump();
    expect(find.text('secret'), findsOneWidget);
    c.dispose();
  });
}
