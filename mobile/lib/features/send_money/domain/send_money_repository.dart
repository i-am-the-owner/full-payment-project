import 'models.dart';

/// The send-money operations the presentation layer depends on.
///
/// Every money decision (fee, exchange rate, transfer status) is made by the
/// payout provider and relayed by the backend. This interface only carries
/// values in and out — the client never computes or overrides them.
abstract interface class SendMoneyRepository {
  /// The currencies the provider supports right now.
  Future<SupportedCurrencies> getCurrencies();

  /// The customer picks the two currencies and ONE amount – what they send or
  /// what the recipient gets; the backend returns the provider's quote.
  Future<Quote> requestQuote({
    required String sourceCurrency,
    required String targetCurrency,
    String? sourceAmount,
    String? targetAmount,
  });

  /// Prices the quote for the chosen recipient. The price may change: the
  /// quote returned is the one to review and confirm.
  Future<Quote> attachRecipient({
    required String quoteId,
    required String recipientId,
  });

  /// The customer's saved recipients.
  Future<List<Recipient>> listRecipients();

  /// The provider's recipient form for [currency] in [country].
  Future<DynamicForm> getRecipientForm({
    required String currency,
    required String country,
    String? quoteId,
    Map<String, String>? partialValues,
  });

  /// Add a recipient. The provider validates the details.
  Future<Recipient> addRecipient(NewRecipient recipient);

  /// Removes a saved recipient from the customer's list.
  Future<void> removeRecipient(String id);

  /// The provider's extra questions for a transfer.
  Future<DynamicForm> getTransferForm({
    required String quoteId,
    required String recipientId,
  });

  /// Confirm. [idempotencyKey] makes a retry safe — a duplicate returns the
  /// original transfer, never a second one.
  Future<Transfer> confirmTransfer({
    required String quoteId,
    required String recipientId,
    required Map<String, String> answers,
    required String idempotencyKey,
    String? reference,
  });

  /// How to pay the provider for a transfer.
  Future<FundingInfo> getFunding(String transferId);

  /// Tells the backend how the customer is paying (`BANK_TRANSFER`/`BALANCE`).
  Future<FundResult> fund(String transferId, String method);

  /// A page of the customer's transfers, newest first.
  Future<TransferPage> listTransfers({int page = 1});

  /// One transfer with its timeline, from the backend's own record.
  Future<Transfer> getTransfer(String id);

  /// Has the backend check the transfer with the provider now.
  Future<Transfer> refreshTransfer(String id);

  Future<Transfer> cancelTransfer(String id);

  /// Development only, mock provider only: makes the mock provider take the
  /// transfer's next step, as a signed webhook.
  Future<void> simulateProviderStep(String id);
}
