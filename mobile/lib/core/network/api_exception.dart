/// A structured error from the AaminPay API, decoded from the
/// `{ "error": { code, message, fieldErrors } }` envelope. `statusCode == 0`
/// means the request never reached the server.
class ApiException implements Exception {
  ApiException({
    required this.statusCode,
    required this.code,
    required this.message,
    this.fieldErrors = const [],
    this.cause,
  });

  factory ApiException.network(Object cause) => ApiException(
    statusCode: 0,
    code: 'NETWORK_ERROR',
    message: 'Could not reach AaminPay. Check your connection and try again.',
    cause: cause,
  );

  final int statusCode;
  final String code;
  final String message;
  final List<ApiFieldError> fieldErrors;
  final Object? cause;

  bool get isUnauthorized => statusCode == 401;
  bool get isNetworkFailure => statusCode == 0;

  @override
  String toString() => 'ApiException($statusCode $code: $message)';
}

class ApiFieldError {
  const ApiFieldError({required this.field, required this.message});

  final String field;
  final String message;
}
