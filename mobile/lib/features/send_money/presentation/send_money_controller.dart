import 'package:flutter/foundation.dart';

import '../../../core/network/api_exception.dart';
import '../data/send_money_repository_impl.dart' show newIdempotencyKey;
import '../domain/models.dart';
import '../domain/send_money_repository.dart';

/// Where the customer is in the send-money flow.
enum SendMoneyStage { amount, recipient, questions, review, pay, status }

/// Which of the two amounts the customer typed. The other one always comes
/// from the provider's quote.
enum AmountSide { send, receive }

/// Drives the send-money flow. It holds the customer's choices and whatever the
/// backend has returned so far. It performs **no** money maths and hard-codes
/// **no** currencies, countries or bank fields: the supported currencies, the
/// fee, rate, totals, forms and status all come from the backend verbatim.
class SendMoneyController extends ChangeNotifier {
  SendMoneyController(this._repository);

  final SendMoneyRepository _repository;

  SendMoneyStage _stage = SendMoneyStage.amount;
  bool _busy = false;
  String? _error;
  Map<String, String> _fieldErrors = const {};

  // What the provider supports, loaded from the backend.
  SupportedCurrencies? _currencies;

  // The customer's choices.
  String? _sourceCurrency;
  String? _targetCurrency;
  AmountSide _side = AmountSide.send;
  String _amount = '';
  String _reference = '';

  // Backend-owned values.
  Quote? _quote;
  bool _quoting = false;
  int _quoteRequest = 0;
  List<Recipient> _recipients = const [];
  Recipient? _recipient;
  Transfer? _transfer;
  FundingInfo? _funding;
  String? _notice;

  /// The provider's extra questions for the transfer, and the answers so far.
  DynamicForm? _transferForm;
  Map<String, String> _answers = const {};

  /// Created once when the customer picks a recipient, and reused for every
  /// retry of that confirmation, so it can never create a second transfer.
  String? _idempotencyKey;

  SendMoneyStage get stage => _stage;
  bool get busy => _busy;

  /// True while a quote is being fetched for the amount screen.
  bool get quoting => _quoting;
  String? get error => _error;

  /// Something the customer should know that is not an error (a new price,
  /// the provider asking for approval).
  String? get notice => _notice;

  /// The provider's complaints about form fields, by field key.
  Map<String, String> get fieldErrors => _fieldErrors;
  SupportedCurrencies? get currencies => _currencies;
  List<String> get sourceCurrencies =>
      _currencies?.sourceCurrencies ?? const [];
  List<String> get targetCurrencies =>
      _currencies?.targetCurrencies ?? const [];
  String? get sourceCurrency => _sourceCurrency;
  String? get targetCurrency => _targetCurrency;
  AmountSide get amountSide => _side;
  String get amount => _amount;
  String get reference => _reference;
  DynamicForm? get transferForm => _transferForm;
  Map<String, String> get answers => _answers;
  Quote? get quote => _quote;
  List<Recipient> get recipients => _recipients;
  Recipient? get recipient => _recipient;
  Transfer? get transfer => _transfer;
  FundingInfo? get funding => _funding;

  /// The provider's name for customers ("your money goes directly to ...").
  String get providerName =>
      _funding?.providerDisplayName ??
      _transfer?.providerDisplayName ??
      _currencies?.providerDisplayName ??
      'our payment partner';

  /// True when the development "simulate the provider" tool may be offered.
  bool get isMockProvider =>
      (_transfer?.providerName ?? _currencies?.providerName) == 'mock';

  /// Saved recipients that can receive the currency being sent.
  List<Recipient> get matchingRecipients => _recipients
      .where((r) => r.currency == _targetCurrency)
      .toList(growable: false);

  /// Countries the target currency can be paid out in, if the provider says.
  List<String> get payoutCountries =>
      _currencies?.payoutCountries[_targetCurrency] ?? const [];

  void reset() {
    _stage = SendMoneyStage.amount;
    _busy = false;
    _quoting = false;
    _error = null;
    _notice = null;
    _fieldErrors = const {};
    _quote = null;
    _amount = '';
    _side = AmountSide.send;
    _reference = '';
    _recipient = null;
    _transfer = null;
    _funding = null;
    _transferForm = null;
    _answers = const {};
    _idempotencyKey = null;
    notifyListeners();
  }

  /// Forgets everything that belongs to the signed-in customer. Called when the
  /// account changes, so one customer's people are never shown to the next.
  void clearCustomerData() {
    _recipients = const [];
    reset();
  }

  /// Loads the currencies the provider supports. Called when the flow opens.
  Future<void> loadCurrencies() async {
    await _run(() async {
      final currencies = await _repository.getCurrencies();
      _currencies = currencies;
      if (!currencies.sourceCurrencies.contains(_sourceCurrency)) {
        _sourceCurrency = currencies.sourceCurrencies.firstOrNull;
      }
      if (!currencies.targetCurrencies.contains(_targetCurrency)) {
        _targetCurrency = currencies.targetCurrencies
            .where((code) => code != _sourceCurrency)
            .firstOrNull;
      }
    });
  }

  void setSourceCurrency(String currency) {
    _sourceCurrency = currency;
    _quote = null;
    notifyListeners();
    updateQuote();
  }

  void setTargetCurrency(String currency) {
    _targetCurrency = currency;
    _quote = null;
    notifyListeners();
    updateQuote();
  }

  /// The customer typed an amount on one side. Nothing is fetched yet.
  void setAmount(AmountSide side, String amount) {
    _side = side;
    _amount = amount.trim();
    _quote = null;
    _error = null;
    notifyListeners();
  }

  /// Null when the typed amount is valid for its currency, else a message.
  String? get amountProblem {
    final code = _side == AmountSide.send ? _sourceCurrency : _targetCurrency;
    final info = code == null ? null : _currencies?.info(code);
    if (_amount.isEmpty) return null;
    // Without the provider's description, the backend is left to judge.
    return info?.validateAmount(_amount);
  }

  /// Asks the backend for the provider's quote for the amount typed. Also used
  /// to renew a quote that has expired. The latest request wins.
  Future<bool> updateQuote() async {
    final source = _sourceCurrency;
    final target = _targetCurrency;
    if (source == null ||
        target == null ||
        _amount.isEmpty ||
        amountProblem != null) {
      return false;
    }
    final request = ++_quoteRequest;
    _quoting = true;
    _error = null;
    notifyListeners();
    try {
      final quote = await _repository.requestQuote(
        sourceCurrency: source,
        targetCurrency: target,
        sourceAmount: _side == AmountSide.send ? _amount : null,
        targetAmount: _side == AmountSide.receive ? _amount : null,
      );
      if (request != _quoteRequest) return false;
      _quote = quote;
      return true;
    } on ApiException catch (e) {
      if (request != _quoteRequest) return false;
      _quote = null;
      _error = _messageOf(e);
      return false;
    } finally {
      if (request == _quoteRequest) {
        _quoting = false;
        notifyListeners();
      }
    }
  }

  /// The quote ran out. Gets a new one and, when a recipient is already
  /// chosen, prices it for them again. The customer sees the new figures.
  Future<void> renewQuote() async {
    final recipient = _recipient;
    final previous = _quote;
    if (!await updateQuote()) return;
    if (recipient != null && _stage != SendMoneyStage.amount) {
      await _run(() async {
        _quote = await _repository.attachRecipient(
          quoteId: _quote!.id,
          recipientId: recipient.id,
        );
        // A new quote is a new confirmation.
        _idempotencyKey = newIdempotencyKey();
      });
    }
    final renewed = _quote;
    if (previous != null && renewed != null && _differs(previous, renewed)) {
      _notice = 'The rate was updated. Please check the new amounts.';
      notifyListeners();
    }
  }

  static bool _differs(Quote a, Quote b) =>
      a.target != b.target || a.fee != b.fee || a.totalToPay != b.totalToPay;

  /// Amount → recipient.
  Future<void> continueToRecipient() async {
    if (_quote == null) return;
    _stage = SendMoneyStage.recipient;
    _error = null;
    _notice = null;
    notifyListeners();
    await loadRecipients();
  }

  Future<void> loadRecipients() async {
    await _run(() async {
      _recipients = await _repository.listRecipients();
    });
  }

  /// The provider's recipient form for the quote currency in [country].
  /// Returns null (with [error] set) if it could not be loaded.
  Future<DynamicForm?> loadRecipientForm({
    required String country,
    Map<String, String>? partialValues,
  }) async {
    final quote = _quote;
    if (quote == null) return null;
    DynamicForm? form;
    await _run(() async {
      form = await _repository.getRecipientForm(
        currency: quote.target.currency,
        country: country,
        quoteId: quote.id,
        partialValues: partialValues,
      );
    });
    return form;
  }

  /// Creates the recipient at the provider. Returns it, or null with [error]
  /// and [fieldErrors] set.
  Future<Recipient?> addRecipient(NewRecipient details) async {
    Recipient? created;
    await _run(() async {
      created = await _repository.addRecipient(details);
      _recipients = [created!, ..._recipients];
    });
    return created;
  }

  Future<void> removeRecipient(Recipient recipient) async {
    await _run(() async {
      await _repository.removeRecipient(recipient.id);
      _recipients = _recipients
          .where((r) => r.id != recipient.id)
          .toList(growable: false);
    });
  }

  /// The customer picked a recipient. The provider prices the quote for them
  /// (the price may change), then we load its extra questions.
  Future<void> selectRecipient(Recipient recipient) async {
    final quote = _quote;
    if (quote == null) return;
    final ok = await _run(() async {
      final priced = await _repository.attachRecipient(
        quoteId: quote.id,
        recipientId: recipient.id,
      );
      final form = await _repository.getTransferForm(
        quoteId: priced.id,
        recipientId: recipient.id,
      );
      _quote = priced;
      _recipient = recipient;
      _transferForm = form;
      _answers = const {};
      _idempotencyKey = newIdempotencyKey();
      _notice = priced.priceChanged
          ? 'The price changed for this recipient. Please check the new amounts.'
          : null;
      _stage = form.isEmpty ? SendMoneyStage.review : SendMoneyStage.questions;
    });
    if (!ok && _quote?.isExpired == true) {
      // Nothing was chosen; the amount screen will fetch a fresh quote.
      _stage = SendMoneyStage.amount;
      notifyListeners();
    }
  }

  /// Extra questions → review.
  void submitAnswers(Map<String, String> answers) {
    _answers = Map.unmodifiable(answers);
    _stage = SendMoneyStage.review;
    _error = null;
    _fieldErrors = const {};
    notifyListeners();
  }

  void setReference(String reference) {
    _reference = reference.trim();
  }

  /// Confirm and send. Safe to call again after a failure or a lost
  /// connection — the same idempotency key is reused, so the backend returns
  /// the transfer it already made rather than making another.
  Future<void> confirm() async {
    final quote = _quote;
    final recipient = _recipient;
    final key = _idempotencyKey;
    if (quote == null || recipient == null || key == null || _busy) {
      return;
    }
    final ok = await _run(() async {
      _transfer = await _repository.confirmTransfer(
        quoteId: quote.id,
        recipientId: recipient.id,
        answers: _answers,
        idempotencyKey: key,
        reference: _reference.isEmpty ? null : _reference,
      );
      _notice = null;
    });
    if (!ok) {
      // The provider's complaints about answers belong on the questions screen.
      final questions =
          _transferForm?.fields.map((f) => f.key).toSet() ?? const <String>{};
      if (_fieldErrors.keys.any(questions.contains)) {
        _stage = SendMoneyStage.questions;
        notifyListeners();
      }
      return;
    }
    if (_transfer!.status == TransferStatus.awaitingFunds) {
      _stage = SendMoneyStage.pay;
      notifyListeners();
      await loadFunding();
    } else {
      _stage = SendMoneyStage.status;
      notifyListeners();
    }
  }

  /// How to pay the provider. Fetched from the backend each time.
  Future<void> loadFunding() async {
    final transfer = _transfer;
    if (transfer == null) return;
    await _run(() async {
      _funding = await _repository.getFunding(transfer.id);
    });
  }

  /// The customer chose how to pay (`BANK_TRANSFER` or `BALANCE`).
  Future<void> pay(String method) async {
    final transfer = _transfer;
    if (transfer == null || _busy) return;
    await _run(() async {
      final result = await _repository.fund(transfer.id, method);
      _transfer = result.transfer;
      _notice = result.message;
      if (result.outcome == 'FUNDED' || result.outcome == 'AWAITING_PAYMENT') {
        _stage = SendMoneyStage.status;
      }
    });
    if (_stage == SendMoneyStage.status) {
      await reloadTransfer(quiet: true);
    }
  }

  /// Opens an existing transfer (from history) on the status screen.
  Future<void> openTransfer(Transfer transfer) async {
    _transfer = transfer;
    _funding = null;
    _notice = null;
    _error = null;
    _stage = SendMoneyStage.status;
    notifyListeners();
    await reloadTransfer(quiet: true);
  }

  /// Back from the status screen to paying, for a transfer not yet paid.
  Future<void> showPayment() async {
    _stage = SendMoneyStage.pay;
    _notice = null;
    notifyListeners();
    await loadFunding();
  }

  /// Reads the transfer and its timeline from the backend's own record. Used
  /// to pick up status changes that arrived by provider webhook. [quiet]
  /// reloads without a spinner and keeps the screen if the network is down.
  Future<void> reloadTransfer({bool quiet = false}) async {
    final current = _transfer;
    if (current == null) return;
    if (quiet) {
      try {
        final fresh = await _repository.getTransfer(current.id);
        if (_transfer?.id == fresh.id) {
          _transfer = fresh;
          notifyListeners();
        }
      } on ApiException {
        // Keep showing what we have; the next poll tries again.
      }
      return;
    }
    await _run(() async {
      _transfer = await _repository.getTransfer(current.id);
    });
  }

  /// Has the backend check the transfer with the provider now.
  Future<void> refreshTransfer() async {
    final current = _transfer;
    if (current == null) return;
    await _run(() async {
      await _repository.refreshTransfer(current.id);
      _transfer = await _repository.getTransfer(current.id);
    });
  }

  Future<void> cancelTransfer() async {
    final current = _transfer;
    if (current == null) return;
    await _run(() async {
      await _repository.cancelTransfer(current.id);
      _transfer = await _repository.getTransfer(current.id);
      _stage = SendMoneyStage.status;
    });
  }

  /// Development only (mock provider): the provider takes its next step.
  Future<void> simulateProviderStep() async {
    final current = _transfer;
    if (current == null) return;
    await _run(() async {
      await _repository.simulateProviderStep(current.id);
      _transfer = await _repository.getTransfer(current.id);
    });
  }

  /// A page of past transfers, or null with [error] set.
  Future<TransferPage?> loadHistory(int page) async {
    try {
      return await _repository.listTransfers(page: page);
    } on ApiException catch (e) {
      _error = _messageOf(e);
      notifyListeners();
      return null;
    }
  }

  /// One step back. Returns false when there is nowhere to go back to (the
  /// flow should close). After confirmation there is no going back.
  bool back() {
    final SendMoneyStage? previous = switch (_stage) {
      SendMoneyStage.amount => null,
      SendMoneyStage.recipient => SendMoneyStage.amount,
      SendMoneyStage.questions => SendMoneyStage.recipient,
      SendMoneyStage.review =>
        (_transferForm?.isEmpty ?? true)
            ? SendMoneyStage.recipient
            : SendMoneyStage.questions,
      SendMoneyStage.pay => null,
      SendMoneyStage.status => null,
    };
    if (previous == null) return false;
    _stage = previous;
    _error = null;
    _fieldErrors = const {};
    notifyListeners();
    return true;
  }

  String _messageOf(ApiException e) =>
      e.fieldErrors.isNotEmpty && e.code != 'LIMIT_EXCEEDED'
      ? e.fieldErrors.first.message
      : e.message;

  Future<bool> _run(Future<void> Function() action) async {
    _busy = true;
    _error = null;
    _fieldErrors = const {};
    notifyListeners();
    try {
      await action();
      return true;
    } on ApiException catch (e) {
      // The backend's own message is the clear one for limits, expiry, etc.
      _error = e.message;
      _fieldErrors = {
        for (final f in e.fieldErrors) f.field.split('.').last: f.message,
      };
      return false;
    } finally {
      _busy = false;
      notifyListeners();
    }
  }
}
