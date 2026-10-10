import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';

/// Asks the device to check the person's fingerprint / face. Faked in tests.
abstract interface class BiometricAuthenticator {
  Future<bool> isAvailable();
  Future<bool> authenticate(String reason);
}

class DeviceBiometricAuthenticator implements BiometricAuthenticator {
  DeviceBiometricAuthenticator({LocalAuthentication? auth})
    : _auth = auth ?? LocalAuthentication();

  final LocalAuthentication _auth;

  @override
  Future<bool> isAvailable() async {
    try {
      if (!await _auth.isDeviceSupported()) return false;
      return (await _auth.getAvailableBiometrics()).isNotEmpty;
    } on Object {
      return false;
    }
  }

  @override
  Future<bool> authenticate(String reason) async {
    try {
      // Biometrics only: no fallback to a device PIN, so "fingerprint" means that.
      return await _auth.authenticate(
        localizedReason: reason,
        biometricOnly: true,
      );
    } on Object {
      return false;
    }
  }
}

/// Remembers, on this device only, whether the fingerprint lock is on.
abstract interface class BiometricPreferenceStore {
  Future<bool> read();
  Future<void> write(bool enabled);
}

class SecureBiometricPreferenceStore implements BiometricPreferenceStore {
  SecureBiometricPreferenceStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  static const _key = 'almapay.biometric_lock';
  final FlutterSecureStorage _storage;

  @override
  Future<bool> read() async => (await _storage.read(key: _key)) == 'on';

  @override
  Future<void> write(bool enabled) => enabled
      ? _storage.write(key: _key, value: 'on')
      : _storage.delete(key: _key);
}

/// The fingerprint lock. It never touches the session tokens: it only decides
/// whether the app is covered by the lock screen.
class BiometricLockController extends ChangeNotifier
    with WidgetsBindingObserver {
  BiometricLockController({
    required BiometricAuthenticator authenticator,
    required BiometricPreferenceStore store,
    this.relockAfter = const Duration(seconds: 30),
  }) : _authenticator = authenticator,
       _store = store;

  final BiometricAuthenticator _authenticator;
  final BiometricPreferenceStore _store;

  /// How long the app can be in the background before it locks again.
  final Duration relockAfter;

  bool _available = false;
  bool _enabled = false;
  bool _locked = false;
  DateTime? _pausedAt;

  bool get available => _available;
  bool get enabled => _enabled;
  bool get locked => _locked;

  /// Reads the saved choice. Locked at start-up when it is on.
  Future<void> init() async {
    _available = await _authenticator.isAvailable();
    _enabled = _available && await _store.read();
    _locked = _enabled;
    WidgetsBinding.instance.addObserver(this);
    notifyListeners();
  }

  Future<bool> unlock() async {
    if (!_locked) return true;
    final ok = await _authenticator.authenticate('Unlock AaminPay');
    if (ok) {
      _locked = false;
      notifyListeners();
    }
    return ok;
  }

  /// Turning it on needs one successful check, so it can't be switched on by
  /// someone who cannot pass it.
  Future<bool> setEnabled(bool value) async {
    if (value == _enabled) return true;
    if (value) {
      if (!_available) return false;
      if (!await _authenticator.authenticate('Turn on fingerprint unlock')) {
        return false;
      }
    }
    await _store.write(value);
    _enabled = value;
    _locked = false;
    notifyListeners();
    return true;
  }

  /// Signing out forgets the choice, so the next account starts without it.
  Future<void> reset() async {
    await _store.write(false);
    _enabled = false;
    _locked = false;
    notifyListeners();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!_enabled) return;
    if (state == AppLifecycleState.paused) {
      _pausedAt = DateTime.now();
    } else if (state == AppLifecycleState.resumed) {
      final at = _pausedAt;
      _pausedAt = null;
      if (at != null && DateTime.now().difference(at) >= relockAfter) {
        _locked = true;
        notifyListeners();
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}

/// Shows [child] unless the lock is on and not yet opened.
class BiometricLockGate extends StatefulWidget {
  const BiometricLockGate({
    required this.controller,
    required this.child,
    super.key,
  });

  final BiometricLockController controller;
  final Widget child;

  @override
  State<BiometricLockGate> createState() => _BiometricLockGateState();
}

class _BiometricLockGateState extends State<BiometricLockGate> {
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onChange);
    _promptIfLocked();
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onChange);
    super.dispose();
  }

  void _onChange() {
    if (!mounted) return;
    setState(() {});
    _promptIfLocked();
  }

  Future<void> _promptIfLocked() async {
    if (!widget.controller.locked) return;
    final ok = await widget.controller.unlock();
    if (mounted && !ok) setState(() => _failed = true);
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.controller.locked) return widget.child;
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.fingerprint, size: 72),
              const SizedBox(height: 16),
              Text(
                'AaminPay is locked',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              if (_failed) ...[
                const SizedBox(height: 8),
                const Text('We could not check your fingerprint.'),
              ],
              const SizedBox(height: 24),
              FilledButton.icon(
                key: const Key('biometric_unlock'),
                onPressed: () {
                  setState(() => _failed = false);
                  _promptIfLocked();
                },
                icon: const Icon(Icons.fingerprint),
                label: const Text('Unlock'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
