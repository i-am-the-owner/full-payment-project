import 'package:http/http.dart' as http;

import '../../features/auth/data/auth_repository_impl.dart';
import '../../features/auth/domain/auth_repository.dart';
import '../../features/auth/presentation/auth_controller.dart';
import '../network/auth_api.dart';
import '../network/authenticated_client.dart';
import 'token_store.dart';

/// Wires the authentication object graph. One instance for the app's lifetime.
///
/// No backend secret ever appears here – only the public API base URL. The
/// mobile app authenticates by exchanging the user's password for tokens; it
/// holds no client secret, signing key, or privileged credential.
class AuthDependencies {
  AuthDependencies._({
    required this.authController,
    required http.Client publicClient,
    required AuthenticatedClient authenticatedClient,
  }) : _publicClient = publicClient,
       _authenticatedClient = authenticatedClient;

  final AuthController authController;

  /// The token-injecting client, for every other signed-in API call.
  http.Client get apiClient => _authenticatedClient;

  final http.Client _publicClient;
  final AuthenticatedClient _authenticatedClient;

  factory AuthDependencies.create({
    required Uri apiBaseUrl,
    TokenStore? tokenStore,
    http.Client? publicClient,
    http.Client Function()? clientFactory,
  }) {
    final newClient = clientFactory ?? http.Client.new;
    final store = tokenStore ?? SecureTokenStore();
    final plainClient = publicClient ?? newClient();

    final publicApi = AuthApi(baseUrl: apiBaseUrl, client: plainClient);

    late final AuthController controller;
    final refresher = TokenRefresher(
      tokenStore: store,
      refresh: publicApi.refresh,
      onSessionExpired: () => controller.onSessionExpired(),
    );
    final authenticatedClient = AuthenticatedClient(
      inner: newClient(),
      tokenStore: store,
      refresher: refresher,
    );
    final authenticatedApi = AuthApi(
      baseUrl: apiBaseUrl,
      client: authenticatedClient,
    );

    final AuthRepository repository = AuthRepositoryImpl(
      publicApi: publicApi,
      authenticatedApi: authenticatedApi,
      tokenStore: store,
    );
    controller = AuthController(repository);

    return AuthDependencies._(
      authController: controller,
      publicClient: plainClient,
      authenticatedClient: authenticatedClient,
    );
  }

  void dispose() {
    authController.dispose();
    _publicClient.close();
    _authenticatedClient.close();
  }
}
