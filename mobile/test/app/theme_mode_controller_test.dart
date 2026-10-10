import 'package:almapay/app/theme_mode_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class _Store implements ThemeModeStore {
  _Store(this.mode);
  ThemeMode mode;
  @override
  Future<ThemeMode> read() async => mode;
  @override
  Future<void> write(ThemeMode m) async => mode = m;
}

void main() {
  test(
    'follows the phone until the customer chooses, then remembers',
    () async {
      final store = _Store(ThemeMode.system);
      final c = ThemeModeController(store);
      await c.init();
      expect(c.mode, ThemeMode.system);

      await c.setMode(ThemeMode.dark);
      expect(c.mode, ThemeMode.dark);
      expect(store.mode, ThemeMode.dark);

      final next = ThemeModeController(store);
      await next.init();
      expect(next.mode, ThemeMode.dark);
      c.dispose();
      next.dispose();
    },
  );
}
