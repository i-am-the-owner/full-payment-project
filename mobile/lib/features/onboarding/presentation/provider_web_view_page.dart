import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

/// The path the backend sends the customer back to when the provider's
/// identity check is finished.
const String onboardingCallbackPath = '/api/v1/onboarding/callback';

/// Whether the web view may load [target]. Only secure pages are allowed;
/// plain `http` is accepted in development builds alone, where the mock
/// provider page is served by a local backend.
bool isAllowedProviderNavigation(Uri target, {required bool allowInsecure}) {
  if (target.scheme == 'https') {
    return true;
  }
  if (target.scheme == 'about') {
    return true;
  }
  return allowInsecure && target.scheme == 'http';
}

/// True when [url] is our backend's callback: the identity check is finished.
bool isOnboardingCallback(Uri url, Uri apiBaseUrl) =>
    url.path == onboardingCallbackPath && url.host == apiBaseUrl.host;

/// Shows the payment provider's identity check inside the app.
///
/// The page belongs to the provider: the app does not read it, fill it in or
/// take anything from it. It only notices when the provider sends the customer
/// back to the AaminPay backend, and then closes.
class ProviderWebViewPage extends StatefulWidget {
  const ProviderWebViewPage({
    required this.url,
    required this.apiBaseUrl,
    required this.allowInsecure,
    super.key,
  });

  final Uri url;
  final Uri apiBaseUrl;
  final bool allowInsecure;

  @override
  State<ProviderWebViewPage> createState() => _ProviderWebViewPageState();
}

class _ProviderWebViewPageState extends State<ProviderWebViewPage> {
  WebViewController? _controller;
  bool _loading = true;
  bool _failed = false;
  bool _closing = false;

  @override
  void initState() {
    super.initState();
    _open();
  }

  Future<void> _open() async {
    // Android only hands the camera to a web page if the app itself holds the
    // camera permission, so ask before the provider's page needs it. iOS asks
    // by itself the first time the page uses the camera.
    if (defaultTargetPlatform == TargetPlatform.android) {
      await Permission.camera.request();
    }
    if (!mounted) {
      return;
    }

    // iOS: identity checks show a live camera preview, which WKWebView only
    // allows inline and without a tap when it is configured so at creation.
    final PlatformWebViewControllerCreationParams params =
        WebViewPlatform.instance is WebKitWebViewPlatform
        ? WebKitWebViewControllerCreationParams(
            allowsInlineMediaPlayback: true,
            mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
          )
        : const PlatformWebViewControllerCreationParams();

    final controller = WebViewController.fromPlatformCreationParams(
      params,
      // Android: this is WebChromeClient.onPermissionRequest. Grant the camera
      // and nothing else (no microphone, location or protected media).
      onPermissionRequest: (request) {
        final onlyCamera = request.types.every(
          (type) => type == WebViewPermissionResourceType.camera,
        );
        if (onlyCamera && request.types.isNotEmpty) {
          request.grant();
        } else {
          request.deny();
        }
      },
    );

    await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    await controller.setNavigationDelegate(
      NavigationDelegate(
        onNavigationRequest: (request) {
          final target = Uri.tryParse(request.url);
          final allowed =
              target != null &&
              isAllowedProviderNavigation(
                target,
                allowInsecure: widget.allowInsecure,
              );
          return allowed
              ? NavigationDecision.navigate
              : NavigationDecision.prevent;
        },
        onPageStarted: (_) {
          if (mounted) setState(() => _loading = true);
        },
        onPageFinished: (url) {
          if (!mounted) return;
          setState(() => _loading = false);
          final uri = Uri.tryParse(url);
          if (uri != null && isOnboardingCallback(uri, widget.apiBaseUrl)) {
            _close();
          }
        },
        onWebResourceError: (error) {
          if (mounted && (error.isForMainFrame ?? false)) {
            setState(() {
              _failed = true;
              _loading = false;
            });
          }
        },
      ),
    );
    final platform = controller.platform;
    if (platform is AndroidWebViewController) {
      await platform.setMediaPlaybackRequiresUserGesture(false);
    }
    await controller.loadRequest(widget.url);
    if (mounted) {
      setState(() => _controller = controller);
    }
  }

  void _close() {
    if (_closing) return;
    _closing = true;
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Identity check'),
        leading: IconButton(
          key: const Key('provider_page_close'),
          icon: const Icon(Icons.close),
          tooltip: 'Close identity check',
          onPressed: _close,
        ),
      ),
      body: SafeArea(
        child: _failed
            ? const Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Text(
                    "We couldn't open the identity check. "
                    'Check your connection, close this page and try again.',
                    textAlign: TextAlign.center,
                  ),
                ),
              )
            : Stack(
                children: [
                  if (controller != null) WebViewWidget(controller: controller),
                  if (_loading || controller == null)
                    Center(
                      child: Semantics(
                        label: 'Loading the identity check',
                        child: const CircularProgressIndicator(),
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}
