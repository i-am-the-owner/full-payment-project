import 'dart:math';

import '../domain/models.dart';
import '../domain/send_money_repository.dart';
import 'send_money_api.dart';

class SendMoneyRepositoryImpl implements SendMoneyRepository {
  SendMoneyRepositoryImpl({required SendMoneyApi api}) : _api = api;

  final SendMoneyApi _api;

  @override
  Future<SupportedCurrencies> getCurrencies() => _api.getCurrencies();

  @override
  Future<Quote> requestQuote({
    required String sourceCurrency,
    required String targetCurrency,
    String? sourceAmount,
    String? targetAmount,
  }) => _api.createQuote(
    sourceCurrency: sourceCurrency,
    targetCurrency: targetCurrency,
    sourceAmount: sourceAmount,
    targetAmount: targetAmount,
  );

  @override
  Future<Quote> attachRecipient({
    required String quoteId,
    required String recipientId,
  }) => _api.attachRecipient(quoteId: quoteId, recipientId: recipientId);

  @override
  Future<List<Recipient>> listRecipients() => _api.listRecipients();

  @override
  Future<DynamicForm> getRecipientForm({
    required String currency,
    required String country,
    String? quoteId,
    Map<String, String>? partialValues,
  }) => _api.getRecipientForm(
    currency: currency,
    country: country,
    quoteId: quoteId,
    partialValues: partialValues,
  );

  @override
  Future<Recipient> addRecipient(NewRecipient recipient) =>
      _api.createRecipient(recipient);

  @override
  Future<void> removeRecipient(String id) => _api.deleteRecipient(id);

  @override
  Future<DynamicForm> getTransferForm({
    required String quoteId,
    required String recipientId,
  }) => _api.getTransferForm(quoteId: quoteId, recipientId: recipientId);

  @override
  Future<Transfer> confirmTransfer({
    required String quoteId,
    required String recipientId,
    required Map<String, String> answers,
    required String idempotencyKey,
    String? reference,
  }) => _api.createTransfer(
    quoteId: quoteId,
    recipientId: recipientId,
    answers: answers,
    idempotencyKey: idempotencyKey,
    reference: reference,
  );

  @override
  Future<FundingInfo> getFunding(String transferId) =>
      _api.getFunding(transferId);

  @override
  Future<FundResult> fund(String transferId, String method) =>
      _api.fund(transferId, method);

  @override
  Future<TransferPage> listTransfers({int page = 1}) =>
      _api.listTransfers(page: page);

  @override
  Future<Transfer> getTransfer(String id) => _api.getTransfer(id);

  @override
  Future<Transfer> refreshTransfer(String id) => _api.refreshTransfer(id);

  @override
  Future<Transfer> cancelTransfer(String id) => _api.cancelTransfer(id);

  @override
  Future<void> simulateProviderStep(String id) => _api.advanceMockTransfer(id);
}

/// A random UUID (version 4) idempotency key for a confirmation attempt.
/// Generated once per "review → confirm" screen and reused for every retry of
/// that same transfer, so a flaky network never produces two transfers. The
/// backend accepts only a UUID here.
String newIdempotencyKey() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
      '${hex.substring(16, 20)}-${hex.substring(20)}';
}
