import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Remembers, on this device, whether the customer chose the light or the dark
/// look. Until they choose, the phone's own setting decides.
abstract interface class ThemeModeStore {
  Future<ThemeMode> read();
  Future<void> write(ThemeMode mode);
}

class SecureThemeModeStore implements ThemeModeStore {
  SecureThemeModeStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  static const _key = 'almapay.theme_mode';
  final FlutterSecureStorage _storage;

  @override
  Future<ThemeMode> read() async => switch (await _storage.read(key: _key)) {
    'light' => ThemeMode.light,
    'dark' => ThemeMode.dark,
    _ => ThemeMode.system,
  };

  @override
  Future<void> write(ThemeMode mode) => mode == ThemeMode.system
      ? _storage.delete(key: _key)
      : _storage.write(key: _key, value: mode.name);
}

class ThemeModeController extends ChangeNotifier {
  ThemeModeController(this._store);

  final ThemeModeStore _store;
  ThemeMode _mode = ThemeMode.system;

  ThemeMode get mode => _mode;

  Future<void> init() async {
    try {
      _mode = await _store.read();
    } on Object {
      _mode = ThemeMode.system;
    }
    notifyListeners();
  }

  Future<void> setMode(ThemeMode mode) async {
    if (mode == _mode) return;
    _mode = mode;
    notifyListeners();
    try {
      await _store.write(mode);
    } on Object {
      // The choice still applies for this session.
    }
  }
}

/// Gives any screen the theme controller without passing it down by hand.
class ThemeScope extends InheritedNotifier<ThemeModeController> {
  const ThemeScope({
    required ThemeModeController controller,
    required super.child,
    super.key,
  }) : super(notifier: controller);

  static ThemeModeController? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<ThemeScope>()?.notifier;
}
