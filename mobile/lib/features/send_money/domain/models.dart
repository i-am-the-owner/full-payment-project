import 'package:flutter/foundation.dart';

/// A money amount as returned by the backend. The backend is authoritative:
/// [display] and [minorUnits] are read straight from the API and never
/// recomputed on the client.
@immutable
class Money {
  const Money({
    required this.currency,
    required this.display,
    required this.minorUnits,
  });

  factory Money.fromJson(Map<String, dynamic> json) => Money(
    currency: json['currency'] as String,
    display: json['amount'] as String,
    minorUnits: json['amountMinor'] as String,
  );

  final String currency;

  /// Pre-formatted decimal string, e.g. `"1.99"`. Show this verbatim.
  final String display;

  /// Integer minor units as a string, e.g. `"199"`. For equality / ordering
  /// only — never for arithmetic that produces a customer-facing figure.
  final String minorUnits;

  String get label => '$display $currency';

  @override
  bool operator ==(Object other) =>
      other is Money &&
      other.currency == currency &&
      other.minorUnits == minorUnits;

  @override
  int get hashCode => Object.hash(currency, minorUnits);
}

/// A quote from the payout provider, relayed by the backend. Opaque [id] plus
/// display values: [source] is the amount converted, [fee] the provider's fee,
/// [totalToPay] what the customer pays. The client cannot alter any of them;
/// confirmation sends only the [id].
@immutable
class Quote {
  const Quote({
    required this.id,
    required this.source,
    required this.fee,
    required this.totalToPay,
    required this.target,
    required this.exchangeRate,
    required this.estimatedDelivery,
    required this.expiresAt,
    this.priceChanged = false,
  });

  factory Quote.fromJson(Map<String, dynamic> json) => Quote(
    priceChanged: json['priceChanged'] as bool? ?? false,
    id: json['id'] as String,
    source: Money.fromJson(json['source'] as Map<String, dynamic>),
    fee: Money.fromJson(json['fee'] as Map<String, dynamic>),
    totalToPay: Money.fromJson(json['totalToPay'] as Map<String, dynamic>),
    target: Money.fromJson(json['target'] as Map<String, dynamic>),
    exchangeRate: json['exchangeRate'] as String,
    estimatedDelivery: _parseDate(json['estimatedDelivery']),
    expiresAt: DateTime.parse(json['expiresAt'] as String),
  );

  final String id;
  final Money source;
  final Money fee;
  final Money totalToPay;
  final Money target;
  final String exchangeRate;
  final DateTime? estimatedDelivery;
  final DateTime expiresAt;

  /// True when the provider changed the price for the chosen recipient: the
  /// customer must be shown the new figures before confirming.
  final bool priceChanged;

  bool get isExpired => DateTime.now().isAfter(expiresAt);

  /// Whole seconds until the quote expires at [now]; never negative.
  int secondsLeft(DateTime now) {
    final left = expiresAt.difference(now).inSeconds;
    return left < 0 ? 0 : left;
  }
}

DateTime? _parseDate(Object? value) =>
    value is String ? DateTime.tryParse(value) : null;

/// A recipient summary. The backend holds no bank details either: those live
/// with the payout provider.
@immutable
class Recipient {
  const Recipient({
    required this.id,
    required this.displayName,
    required this.accountHolderName,
    required this.country,
    required this.currency,
    required this.accountSummary,
    required this.isActive,
  });

  factory Recipient.fromJson(Map<String, dynamic> json) => Recipient(
    id: json['id'] as String,
    displayName: json['displayName'] as String,
    accountHolderName: json['accountHolderName'] as String,
    country: json['country'] as String,
    currency: json['currency'] as String,
    accountSummary: json['accountSummary'] as String? ?? '',
    isActive: json['isActive'] as bool? ?? true,
  );

  final String id;
  final String displayName;
  final String accountHolderName;
  final String country;
  final String currency;

  /// Masked identifier from the backend, e.g. `"IBAN ••••1234"`.
  final String accountSummary;
  final bool isActive;
}

/// The backend's single transfer lifecycle (see docs/STATUSES.md). The client
/// only ever *displays* these — it never decides one.
enum TransferStatus {
  draft('DRAFT', 'Preparing'),
  awaitingFunds('AWAITING_FUNDS', 'Waiting for your money'),
  processing('PROCESSING', 'Processing'),
  sent('SENT', 'Sent'),
  completed('COMPLETED', 'Delivered'),
  cancelled('CANCELLED', 'Cancelled'),
  refunded('REFUNDED', 'Refunded'),
  failed('FAILED', 'Failed'),
  unknown('UNKNOWN', 'Unknown');

  const TransferStatus(this.wire, this.label);

  final String wire;
  final String label;

  static TransferStatus fromWire(String wire) => values.firstWhere(
    (s) => s.wire == wire,
    orElse: () => TransferStatus.unknown,
  );

  bool get isSettled =>
      this == completed ||
      this == failed ||
      this == cancelled ||
      this == refunded;

  bool get isCancellable => this == draft || this == awaitingFunds;
}

/// One status a transfer entered, and when. From the backend's own record.
@immutable
class TimelineEvent {
  const TimelineEvent({required this.status, required this.occurredAt});

  factory TimelineEvent.fromJson(Map<String, dynamic> json) => TimelineEvent(
    status: TransferStatus.fromWire(json['status'] as String),
    occurredAt: DateTime.parse(json['occurredAt'] as String),
  );

  final TransferStatus status;
  final DateTime occurredAt;
}

@immutable
class Transfer {
  const Transfer({
    required this.id,
    required this.reference,
    required this.status,
    required this.source,
    required this.fee,
    required this.totalToPay,
    required this.target,
    required this.exchangeRate,
    required this.recipientId,
    required this.failureReason,
    required this.createdAt,
    required this.updatedAt,
    this.recipientReference,
    this.providerName,
    this.providerDisplayName,
    this.fundingMethod,
    this.recipient,
    this.timeline = const [],
  });

  factory Transfer.fromJson(Map<String, dynamic> json) => Transfer(
    id: json['id'] as String,
    reference: json['reference'] as String,
    status: TransferStatus.fromWire(json['status'] as String),
    source: Money.fromJson(json['source'] as Map<String, dynamic>),
    fee: Money.fromJson(json['fee'] as Map<String, dynamic>),
    totalToPay: Money.fromJson(json['totalToPay'] as Map<String, dynamic>),
    target: Money.fromJson(json['target'] as Map<String, dynamic>),
    exchangeRate: json['exchangeRate'] as String,
    recipientId: json['recipientId'] as String,
    failureReason: json['failureReason'] as String?,
    createdAt: DateTime.parse(json['createdAt'] as String),
    updatedAt: DateTime.parse(json['updatedAt'] as String),
    recipientReference: json['recipientReference'] as String?,
    providerName:
        (json['provider'] as Map<String, dynamic>?)?['name'] as String?,
    providerDisplayName:
        (json['provider'] as Map<String, dynamic>?)?['displayName'] as String?,
    fundingMethod: json['fundingMethod'] as String?,
    recipient: json['recipient'] is Map<String, dynamic>
        ? Recipient.fromJson(json['recipient'] as Map<String, dynamic>)
        : null,
    timeline: ((json['timeline'] as List<dynamic>?) ?? const [])
        .map((e) => TimelineEvent.fromJson(e as Map<String, dynamic>))
        .toList(growable: false),
  );

  /// The customer's own reference for the recipient, if they gave one.
  final String? recipientReference;

  /// The provider's code (`mock`, `wise`, ...) and its name for customers.
  final String? providerName;
  final String? providerDisplayName;

  /// `BANK_TRANSFER` or `BALANCE`, once the customer has chosen.
  final String? fundingMethod;

  /// The recipient summary. Present on a transfer loaded by id.
  final Recipient? recipient;

  /// Each status the transfer entered, oldest first. Present on a transfer
  /// loaded by id.
  final List<TimelineEvent> timeline;

  final String id;
  final String reference;
  final TransferStatus status;
  final Money source;
  final Money fee;
  final Money totalToPay;
  final Money target;
  final String exchangeRate;
  final String recipientId;
  final String? failureReason;
  final DateTime createdAt;
  final DateTime updatedAt;
}

/// The details the customer enters for a new recipient: the values of the
/// provider's own form (see [DynamicForm]). Which fields exist is decided by
/// the provider at runtime, never by the app.
@immutable
class NewRecipient {
  const NewRecipient({
    required this.currency,
    required this.country,
    required this.values,
    this.displayName,
  });

  final String currency;
  final String country;
  final Map<String, String> values;
  final String? displayName;

  Map<String, dynamic> toJson() => {
    'currency': currency,
    'country': country,
    'values': values,
    if (displayName != null && displayName!.isNotEmpty)
      'displayName': displayName,
  };
}

/// What the payout provider supports right now. Fetched from the backend;
/// nothing here is hard-coded in the app.
@immutable
class SupportedCurrencies {
  const SupportedCurrencies({
    required this.sourceCurrencies,
    required this.targetCurrencies,
    this.currencies = const [],
    this.providerName,
    this.providerDisplayName,
    this.payoutCountries = const {},
  });

  factory SupportedCurrencies.fromJson(Map<String, dynamic> json) =>
      SupportedCurrencies(
        sourceCurrencies: _strings(json['sourceCurrencies']),
        targetCurrencies: _strings(json['targetCurrencies']),
        currencies: ((json['currencies'] as List<dynamic>?) ?? const [])
            .map((e) => CurrencyInfo.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
        providerName:
            (json['provider'] as Map<String, dynamic>?)?['name'] as String?,
        providerDisplayName:
            (json['provider'] as Map<String, dynamic>?)?['displayName']
                as String?,
        payoutCountries:
            ((json['payoutCountries'] as Map<String, dynamic>?) ?? const {})
                .map((code, value) => MapEntry(code, _strings(value))),
      );

  final List<String> sourceCurrencies;
  final List<String> targetCurrencies;

  /// Name and decimal places of each currency, from the provider.
  final List<CurrencyInfo> currencies;
  final String? providerName;
  final String? providerDisplayName;

  /// For each currency, the countries it can be paid out in. Empty when the
  /// provider does not publish this.
  final Map<String, List<String>> payoutCountries;

  CurrencyInfo? info(String code) =>
      currencies.where((c) => c.code == code).firstOrNull;
}

/// A currency as the provider describes it.
@immutable
class CurrencyInfo {
  const CurrencyInfo({
    required this.code,
    required this.name,
    required this.minorUnit,
  });

  factory CurrencyInfo.fromJson(Map<String, dynamic> json) => CurrencyInfo(
    code: json['code'] as String,
    name: json['name'] as String? ?? json['code'] as String,
    minorUnit: json['minorUnit'] as int? ?? 2,
  );

  final String code;
  final String name;

  /// Decimal places: 2 for GBP, 0 for JPY, 3 for KWD.
  final int minorUnit;

  /// Null when [input] is a valid amount in this currency, else a message.
  /// Checked as text: the amount is never turned into a floating-point number.
  String? validateAmount(String input) {
    final value = input.trim();
    if (value.isEmpty) return 'Enter an amount';
    final pattern = minorUnit == 0
        ? RegExp(r'^\d{1,12}$')
        : RegExp('^\\d{1,12}(\\.\\d{1,$minorUnit})?\$');
    if (!pattern.hasMatch(value)) {
      return minorUnit == 0
          ? 'Enter a whole amount, without decimals'
          : 'Enter an amount with up to $minorUnit decimal places';
    }
    if (RegExp(r'^[0.]+$').hasMatch(value)) return 'Enter an amount above zero';
    return null;
  }
}

/// One way to pay the provider for a transfer.
@immutable
class FundingOption {
  const FundingOption({
    required this.method,
    required this.amount,
    this.bankDetails = const [],
    this.reference,
  });

  factory FundingOption.fromJson(Map<String, dynamic> json) => FundingOption(
    method: json['method'] as String,
    amount: Money.fromJson(json['amount'] as Map<String, dynamic>),
    bankDetails: ((json['bankDetails'] as List<dynamic>?) ?? const [])
        .map((e) {
          final detail = e as Map<String, dynamic>;
          return BankDetail(
            label: detail['label'] as String,
            value: detail['value'] as String,
          );
        })
        .toList(growable: false),
    reference: json['reference'] as String?,
  );

  /// `BANK_TRANSFER` or `BALANCE`.
  final String method;
  final Money amount;

  /// The PROVIDER's bank account, for a bank transfer. Never AaminPay's.
  final List<BankDetail> bankDetails;

  /// The reference the customer must quote when paying the provider.
  final String? reference;

  bool get isBankTransfer => method == 'BANK_TRANSFER';
  bool get isBalance => method == 'BALANCE';
}

@immutable
class BankDetail {
  const BankDetail({required this.label, required this.value});

  final String label;
  final String value;
}

/// How to pay the provider for one transfer.
@immutable
class FundingInfo {
  const FundingInfo({required this.providerDisplayName, required this.options});

  factory FundingInfo.fromJson(Map<String, dynamic> json) => FundingInfo(
    providerDisplayName:
        (json['provider'] as Map<String, dynamic>?)?['displayName']
            as String? ??
        'our payment partner',
    options: ((json['methods'] as List<dynamic>?) ?? const [])
        .map((e) => FundingOption.fromJson(e as Map<String, dynamic>))
        .toList(growable: false),
  );

  final String providerDisplayName;
  final List<FundingOption> options;

  FundingOption? get bankTransfer =>
      options.where((o) => o.isBankTransfer).firstOrNull;
  FundingOption? get balance => options.where((o) => o.isBalance).firstOrNull;
}

/// The backend's answer to "pay this way".
@immutable
class FundResult {
  const FundResult({
    required this.outcome,
    required this.message,
    required this.transfer,
  });

  factory FundResult.fromJson(Map<String, dynamic> json) => FundResult(
    outcome: json['outcome'] as String,
    message: json['message'] as String?,
    transfer: Transfer.fromJson(json['transfer'] as Map<String, dynamic>),
  );

  /// `FUNDED`, `AWAITING_PAYMENT`, `SCA_REQUIRED` or `REJECTED`.
  final String outcome;

  /// What to show the customer, when there is something to do or know.
  final String? message;
  final Transfer transfer;

  bool get needsApproval => outcome == 'SCA_REQUIRED';
}

/// One page of the customer's transfers, newest first.
@immutable
class TransferPage {
  const TransferPage({
    required this.transfers,
    required this.page,
    required this.hasMore,
  });

  factory TransferPage.fromJson(Map<String, dynamic> json) => TransferPage(
    transfers: ((json['transfers'] as List<dynamic>?) ?? const [])
        .map((e) => Transfer.fromJson(e as Map<String, dynamic>))
        .toList(growable: false),
    page: json['page'] as int? ?? 1,
    hasMore: json['hasMore'] as bool? ?? false,
  );

  final List<Transfer> transfers;
  final int page;
  final bool hasMore;
}

List<String> _strings(Object? value) => ((value as List<dynamic>?) ?? const [])
    .cast<String>()
    .toList(growable: false);

@immutable
class FormFieldOption {
  const FormFieldOption({required this.value, required this.label});

  factory FormFieldOption.fromJson(Map<String, dynamic> json) =>
      FormFieldOption(
        value: json['value'] as String,
        label: json['label'] as String,
      );

  final String value;
  final String label;
}

/// One field of a provider-defined form.
@immutable
class DynamicFormField {
  const DynamicFormField({
    required this.key,
    required this.label,
    required this.type,
    required this.required,
    required this.group,
    required this.pattern,
    required this.minLength,
    required this.maxLength,
    required this.options,
    required this.refreshOnChange,
    required this.example,
  });

  factory DynamicFormField.fromJson(Map<String, dynamic> json) {
    final validation =
        (json['validation'] as Map<String, dynamic>?) ?? const {};
    return DynamicFormField(
      key: json['key'] as String,
      label: json['label'] as String,
      type: json['type'] as String? ?? 'text',
      required: json['required'] as bool? ?? false,
      group: json['group'] as String? ?? '',
      pattern: validation['pattern'] as String?,
      minLength: validation['minLength'] as int?,
      maxLength: validation['maxLength'] as int?,
      options: ((json['options'] as List<dynamic>?) ?? const [])
          .map((e) => FormFieldOption.fromJson(e as Map<String, dynamic>))
          .toList(growable: false),
      refreshOnChange: json['refreshOnChange'] as bool? ?? false,
      example: json['example'] as String?,
    );
  }

  final String key;
  final String label;

  /// `text`, `select`, `radio` or `date`.
  final String type;
  final bool required;
  final String group;
  final String? pattern;
  final int? minLength;
  final int? maxLength;
  final List<FormFieldOption> options;

  /// The form must be fetched again, with the values so far, when this changes.
  final bool refreshOnChange;
  final String? example;

  bool get isSelect => type == 'select';
  bool get isRadio => type == 'radio';
  bool get isDate => type == 'date';

  /// A first, local check using the provider's own rules (required, length,
  /// pattern, allowed choices). The provider remains the authority: it
  /// validates again when the form is submitted.
  String? validate(String? input) {
    final value = (input ?? '').trim();
    if (value.isEmpty) return required ? 'Enter ${_lower(label)}' : null;
    if (minLength != null && value.length < minLength!) {
      return 'Must be at least $minLength characters';
    }
    if (maxLength != null && value.length > maxLength!) {
      return 'Must be $maxLength characters or fewer';
    }
    if (pattern != null) {
      RegExp? rule;
      try {
        rule = RegExp(pattern!);
      } on FormatException {
        // A pattern this app cannot read is left for the provider to check.
        rule = null;
      }
      if (rule != null && !rule.hasMatch(value)) {
        return example == null
            ? 'This does not look right. Check it and try again'
            : 'This does not look right. It should look like $example';
      }
    }
    if (options.isNotEmpty && !options.any((o) => o.value == value)) {
      return 'Choose one of the options';
    }
    if (isDate && DateTime.tryParse(value) == null) {
      return 'Enter a date';
    }
    return null;
  }

  static String _lower(String label) => label.isEmpty
      ? 'a value'
      : 'the ${label[0].toLowerCase()}${label.substring(1)}';
}

@immutable
class DynamicFormGroup {
  const DynamicFormGroup({required this.key, required this.label});

  factory DynamicFormGroup.fromJson(Map<String, dynamic> json) =>
      DynamicFormGroup(
        key: json['key'] as String,
        label: json['label'] as String,
      );

  final String key;
  final String label;
}

/// A form whose fields come from the payout provider at runtime.
@immutable
class DynamicForm {
  const DynamicForm({required this.groups, required this.fields});

  factory DynamicForm.fromJson(Map<String, dynamic> json) => DynamicForm(
    groups: ((json['groups'] as List<dynamic>?) ?? const [])
        .map((e) => DynamicFormGroup.fromJson(e as Map<String, dynamic>))
        .toList(growable: false),
    fields: ((json['fields'] as List<dynamic>?) ?? const [])
        .map((e) => DynamicFormField.fromJson(e as Map<String, dynamic>))
        .toList(growable: false),
  );

  final List<DynamicFormGroup> groups;
  final List<DynamicFormField> fields;

  bool get isEmpty => fields.isEmpty;

  /// Keeps only the values that belong to a field of this form. Used after a
  /// `refreshOnChange` reload, so what the customer typed survives while
  /// values for fields that no longer exist are dropped.
  Map<String, String> keepKnown(Map<String, String> values) {
    final known = fields.map((f) => f.key).toSet();
    return {
      for (final entry in values.entries)
        if (known.contains(entry.key)) entry.key: entry.value,
    };
  }
}
