import 'package:flutter/material.dart';

import 'app/almapay_app.dart';
import 'app/environment/app_config.dart';
import 'app/environment/app_environment.dart';
import 'core/auth/auth_dependencies.dart';
import 'core/network/certificate_pinning.dart';

void main() {
  final environment = AppEnvironment.resolve();
  final config = AppConfig.forEnvironment(environment);
  // Pinning is OFF unless the build asks for it (see GO_LIVE.md); it refuses to
  // start in a configuration that could not work.
  final clientFactory = clientFactoryFor(
    PinningConfig.fromEnvironment(),
    config.apiBaseUrl,
  );
  final auth = AuthDependencies.create(
    apiBaseUrl: config.apiBaseUrl,
    clientFactory: clientFactory,
  );

  runApp(AlmaPayApp(config: config, auth: auth));
}
