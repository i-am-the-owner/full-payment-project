import 'dart:async';

import 'package:flutter/material.dart';

import '../../../shared/theme/almapay_theme.dart';
import '../../../shared/widgets/aamin_ticket.dart';
import '../../../shared/widgets/person_row.dart';
import '../domain/models.dart';
import 'pay_and_status.dart';
import 'send_money_controller.dart';
import 'widgets/amount_row.dart';
import 'widgets/banners.dart';
import 'widgets/currency_picker.dart';
import 'widgets/dynamic_form_fields.dart';
import 'widgets/quote_countdown.dart';

/// Hosts the whole send-money flow: amount → recipient → extra questions →
/// review → pay → status. A single screen that swaps its body as
/// [SendMoneyController.stage] advances. The backend is authoritative
/// throughout — this widget only collects input and renders backend responses,
/// including the currency lists and the provider's own forms.
class SendMoneyFlowPage extends StatefulWidget {
  const SendMoneyFlowPage({
    required this.controller,
    this.openTransfer,
    this.devTools = false,
    this.now = DateTime.now,
    super.key,
  });

  final SendMoneyController controller;

  /// When set, the page opens on this existing transfer's status instead of
  /// starting a new transfer.
  final Transfer? openTransfer;

  /// Offers the mock provider's "next step" tool. Never set in production.
  final bool devTools;

  /// The clock for the quote countdown, replaceable in tests.
  final DateTime Function() now;

  @override
  State<SendMoneyFlowPage> createState() => _SendMoneyFlowPageState();
}

class _SendMoneyFlowPageState extends State<SendMoneyFlowPage> {
  @override
  void initState() {
    super.initState();
    final existing = widget.openTransfer;
    // After the first frame: these notify listeners.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (existing != null) {
        _c.openTransfer(existing);
      } else {
        _c.reset();
        _c.loadCurrencies();
      }
    });
  }

  SendMoneyController get _c => widget.controller;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _c,
      builder: (context, _) {
        final stage = _c.stage;
        final canLeave =
            stage == SendMoneyStage.amount ||
            stage == SendMoneyStage.pay ||
            stage == SendMoneyStage.status;
        return PopScope(
          canPop: canLeave,
          onPopInvokedWithResult: (didPop, _) {
            if (!didPop) _c.back();
          },
          child: Scaffold(
            appBar: AppBar(title: Text(_titleFor(stage))),
            body: SafeArea(
              child: Column(
                children: [
                  SizedBox(
                    height: 4,
                    child: _c.busy
                        ? Semantics(
                            label: 'Working',
                            child: const LinearProgressIndicator(),
                          )
                        : null,
                  ),
                  Expanded(
                    child: AbsorbPointer(
                      // No second tap while a request is on its way.
                      absorbing: _c.busy,
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(16),
                        child: Center(
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 560),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                if (_c.error != null)
                                  MessageBanner(
                                    key: const Key('send_money_error'),
                                    text: _c.error!,
                                    isError: true,
                                  ),
                                if (_c.notice != null)
                                  MessageBanner(
                                    key: const Key('send_money_notice'),
                                    text: _c.notice!,
                                  ),
                                _bodyFor(stage),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  String _titleFor(SendMoneyStage stage) => switch (stage) {
    SendMoneyStage.amount => 'Send money',
    SendMoneyStage.recipient => 'Who are you sending to?',
    SendMoneyStage.questions => 'A few questions',
    SendMoneyStage.review => 'Check your transfer',
    SendMoneyStage.pay => 'Payment',
    SendMoneyStage.status => 'Your transfer',
  };

  Widget _bodyFor(SendMoneyStage stage) => switch (stage) {
    SendMoneyStage.amount => _AmountStep(controller: _c, now: widget.now),
    SendMoneyStage.recipient => _RecipientStep(controller: _c),
    SendMoneyStage.questions => _QuestionsStep(controller: _c),
    SendMoneyStage.review => _ReviewStep(controller: _c, now: widget.now),
    SendMoneyStage.pay => PayStep(controller: _c),
    SendMoneyStage.status => TransferStatusView(
      controller: _c,
      devTools: widget.devTools,
    ),
  };
}

// --- 1. Amount -------------------------------------------------------------

class _AmountStep extends StatefulWidget {
  const _AmountStep({required this.controller, required this.now});
  final SendMoneyController controller;
  final DateTime Function() now;

  @override
  State<_AmountStep> createState() => _AmountStepState();
}

class _AmountStepState extends State<_AmountStep> {
  late final TextEditingController _send;
  late final TextEditingController _receive;
  Timer? _debounce;

  SendMoneyController get _c => widget.controller;

  @override
  void initState() {
    super.initState();
    final typed = _c.amount;
    _send = TextEditingController(
      text: _c.amountSide == AmountSide.send
          ? typed
          : _c.quote?.totalToPay.display ?? '',
    );
    _receive = TextEditingController(
      text: _c.amountSide == AmountSide.receive
          ? typed
          : _c.quote?.target.display ?? '',
    );
    _c.addListener(_showQuote);
  }

  @override
  void dispose() {
    _c.removeListener(_showQuote);
    _debounce?.cancel();
    _send.dispose();
    _receive.dispose();
    super.dispose();
  }

  /// Fills in the side the customer did not type, from the provider's quote.
  void _showQuote() {
    final quote = _c.quote;
    final other = _c.amountSide == AmountSide.send ? _receive : _send;
    final text = quote == null
        ? ''
        : _c.amountSide == AmountSide.send
        ? quote.target.display
        : quote.totalToPay.display;
    if (other.text != text) {
      other.text = text;
    }
  }

  void _typed(AmountSide side, String value) {
    _c.setAmount(side, value);
    _debounce?.cancel();
    // Wait for a pause in typing before asking for a rate.
    _debounce = Timer(const Duration(milliseconds: 400), _c.updateQuote);
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    final quote = c.quote;
    final problem = c.amountProblem;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _AmountTicket(
          band: AlmaPayColours.blue,
          title: 'You send',
          fieldKey: const Key('amount_send'),
          controller: _send,
          errorText: c.amountSide == AmountSide.send ? problem : null,
          onChanged: (v) => _typed(AmountSide.send, v),
          picker: CurrencyPickerButton(
            key: const Key('source_currency'),
            label: 'Currency you send',
            selected: c.sourceCurrency,
            codes: c.sourceCurrencies,
            currencies: c.currencies,
            onSelected: c.setSourceCurrency,
          ),
        ),
        const SizedBox(height: 14),
        _AmountTicket(
          band: AlmaPayColours.paid,
          title: 'They get',
          fieldKey: const Key('amount_receive'),
          controller: _receive,
          errorText: c.amountSide == AmountSide.receive ? problem : null,
          onChanged: (v) => _typed(AmountSide.receive, v),
          picker: CurrencyPickerButton(
            key: const Key('target_currency'),
            label: 'Currency they receive',
            selected: c.targetCurrency,
            codes: c.targetCurrencies,
            currencies: c.currencies,
            onSelected: c.setTargetCurrency,
          ),
        ),
        const SizedBox(height: 16),
        if (c.quoting)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(
              'Getting the rate…',
              style: AlmaPayText.ui(color: AlmaPayColours.ink2),
            ),
          )
        else if (quote != null) ...[
          QuoteBreakdown(quote: quote),
          const SizedBox(height: 10),
          Center(
            child: QuoteCountdown(
              quote: quote,
              now: widget.now,
              onExpired: c.renewQuote,
            ),
          ),
        ] else
          Text(
            'Type an amount in either box to see the rate and fee.',
            style: AlmaPayText.ui(size: 15, color: AlmaPayColours.ink2),
          ),
        const SizedBox(height: 24),
        PrimaryButton(
          key: const Key('amount_continue'),
          label: 'Continue',
          onPressed: quote == null || c.quoting || c.busy
              ? null
              : c.continueToRecipient,
        ),
      ],
    );
  }
}

/// One side of the amount screen drawn as a ticket: a coloured top with the
/// label and currency picker, and the amount typed on the stub.
class _AmountTicket extends StatelessWidget {
  const _AmountTicket({
    required this.band,
    required this.title,
    required this.fieldKey,
    required this.controller,
    required this.onChanged,
    required this.picker,
    required this.errorText,
  });

  final Color band;
  final String title;
  final Key fieldKey;
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final Widget picker;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    return AaminTicket(
      band: band,
      topHeight: 58,
      topPadding: const EdgeInsets.symmetric(horizontal: 18),
      stubPadding: const EdgeInsets.fromLTRB(18, 8, 18, 14),
      top: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: AlmaPayText.ui(
                size: 15,
                weight: 600,
                color: AlmaPayColours.white,
              ),
            ),
          ),
          picker,
        ],
      ),
      stub: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: fieldKey,
            controller: controller,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            style: AlmaPayText.display.copyWith(fontSize: 46),
            cursorColor: AlmaPayColours.blue,
            decoration: InputDecoration(
              labelText: title,
              floatingLabelBehavior: FloatingLabelBehavior.never,
              filled: false,
              border: InputBorder.none,
              enabledBorder: InputBorder.none,
              focusedBorder: InputBorder.none,
              contentPadding: EdgeInsets.zero,
              isDense: true,
              errorText: errorText,
              errorMaxLines: 3,
            ),
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }
}

// --- 2. Recipient ----------------------------------------------------------

class _RecipientStep extends StatefulWidget {
  const _RecipientStep({required this.controller});
  final SendMoneyController controller;

  @override
  State<_RecipientStep> createState() => _RecipientStepState();
}

class _RecipientStepState extends State<_RecipientStep> {
  final _formKey = GlobalKey<FormState>();
  final _countryText = TextEditingController();
  final _nickname = TextEditingController();
  bool _adding = false;
  String? _country;
  DynamicForm? _form;
  Map<String, String> _values = {};

  SendMoneyController get _c => widget.controller;

  @override
  void dispose() {
    _countryText.dispose();
    _nickname.dispose();
    super.dispose();
  }

  Future<void> _startAdding() async {
    setState(() => _adding = true);
    final countries = _c.payoutCountries;
    if (countries.length == 1) {
      await _chooseCountry(countries.single);
    }
  }

  Future<void> _chooseCountry(String country) async {
    setState(() {
      _country = country;
      _form = null;
      _values = {};
    });
    final form = await _c.loadRecipientForm(country: country);
    if (mounted && _country == country) {
      setState(() => _form = form);
    }
  }

  /// A field changed that changes the form itself: fetch it again with what
  /// has been entered. The renderer keeps everything already typed.
  Future<void> _refresh(Map<String, String> values) async {
    final country = _country;
    if (country == null) return;
    final form = await _c.loadRecipientForm(
      country: country,
      partialValues: values,
    );
    if (mounted && form != null && _country == country) {
      setState(() => _form = form);
    }
  }

  Future<void> _save() async {
    final country = _country;
    if (country == null || !_formKey.currentState!.validate()) return;
    final created = await _c.addRecipient(
      NewRecipient(
        currency: _c.targetCurrency ?? '',
        country: country,
        values: _values,
        displayName: _nickname.text.trim(),
      ),
    );
    if (created != null) {
      await _c.selectRecipient(created);
    }
  }

  Future<void> _remove(Recipient recipient) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Remove ${recipient.displayName}?'),
        content: const Text(
          'They will be taken off your list. Transfers you have already '
          'made to them are not affected.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep'),
          ),
          TextButton(
            key: const Key('recipient_remove_confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _c.removeRecipient(recipient);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    final saved = c.matchingRecipients;
    final currency = c.targetCurrency ?? '';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (saved.isEmpty && !_adding)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text('You have no saved recipients for $currency yet.'),
          ),
        if (saved.isNotEmpty)
          Panel(
            children: [
              for (final r in saved)
                InkWell(
                  key: Key('recipient_${r.id}'),
                  onTap: () => c.selectRecipient(r),
                  child: PersonRow(
                    person: r,
                    trailing: IconButton(
                      key: Key('recipient_remove_${r.id}'),
                      icon: const Icon(Icons.delete_outline),
                      tooltip: 'Remove ${r.displayName}',
                      onPressed: () => _remove(r),
                    ),
                  ),
                ),
            ],
          ),
        const SizedBox(height: 14),
        if (!_adding)
          SecondaryButton(
            key: const Key('recipient_add'),
            label: 'Add a new recipient',
            onPressed: _startAdding,
          )
        else
          _addForm(context, currency),
      ],
    );
  }

  Widget _addForm(BuildContext context, String currency) {
    final c = _c;
    final countries = c.payoutCountries;
    final form = _form;
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            header: true,
            child: Text(
              'New recipient',
              style: Theme.of(context).textTheme.titleLarge,
            ),
          ),
          const SizedBox(height: 12),
          if (countries.length > 1)
            DropdownButtonFormField<String>(
              key: const Key('recipient_country'),
              initialValue: _country,
              decoration: const InputDecoration(
                labelText: 'Country of the bank account',
              ),
              items: [
                for (final code in countries)
                  DropdownMenuItem(value: code, child: Text(code)),
              ],
              onChanged: (v) => v == null ? null : _chooseCountry(v),
              validator: (v) => v == null ? 'Choose a country' : null,
            )
          else if (countries.isEmpty)
            // The provider did not say where this currency can be paid out.
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextFormField(
                    key: const Key('recipient_country'),
                    controller: _countryText,
                    textCapitalization: TextCapitalization.characters,
                    maxLength: 2,
                    decoration: const InputDecoration(
                      labelText: 'Country of the bank account',
                      helperText: '2-letter code, for example DE',
                    ),
                    validator: (v) =>
                        RegExp(r'^[A-Za-z]{2}$').hasMatch((v ?? '').trim())
                        ? null
                        : 'Enter a 2-letter country code',
                  ),
                ),
                const SizedBox(width: 12),
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: OutlinedButton(
                    key: const Key('recipient_country_load'),
                    onPressed: () {
                      final code = _countryText.text.trim().toUpperCase();
                      if (RegExp(r'^[A-Z]{2}$').hasMatch(code)) {
                        _chooseCountry(code);
                      }
                    },
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(72, 48),
                    ),
                    child: const Text('Next'),
                  ),
                ),
              ],
            )
          else
            Text('Bank account in: ${countries.single}'),
          const SizedBox(height: 12),
          if (form != null) ...[
            DynamicFormFields(
              key: ValueKey('recipient_form_$_country'),
              form: form,
              serverErrors: c.fieldErrors,
              onChanged: (values) => _values = values,
              onRefresh: _refresh,
            ),
            TextFormField(
              key: const Key('recipient_nickname'),
              controller: _nickname,
              maxLength: 120,
              decoration: const InputDecoration(
                labelText: 'Nickname (optional)',
                helperText: 'Only you see this',
              ),
            ),
            const SizedBox(height: 12),
            PrimaryButton(
              key: const Key('recipient_save'),
              label: 'Save and continue',
              onPressed: c.busy ? null : _save,
            ),
          ],
        ],
      ),
    );
  }
}

// --- 3. Extra questions ----------------------------------------------------

class _QuestionsStep extends StatefulWidget {
  const _QuestionsStep({required this.controller});
  final SendMoneyController controller;

  @override
  State<_QuestionsStep> createState() => _QuestionsStepState();
}

class _QuestionsStepState extends State<_QuestionsStep> {
  final _formKey = GlobalKey<FormState>();
  late Map<String, String> _values = Map.of(widget.controller.answers);

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final form = c.transferForm;
    if (form == null) return const SizedBox.shrink();
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          StepHeading('${c.providerName} needs to know'),
          DynamicFormFields(
            form: form,
            initialValues: c.answers,
            serverErrors: c.fieldErrors,
            onChanged: (values) => _values = values,
          ),
          const SizedBox(height: 12),
          PrimaryButton(
            key: const Key('questions_continue'),
            label: 'Continue',
            onPressed: () {
              if (_formKey.currentState!.validate()) {
                c.submitAnswers(_values);
              }
            },
          ),
        ],
      ),
    );
  }
}

// --- 4. Review -------------------------------------------------------------

class _ReviewStep extends StatefulWidget {
  const _ReviewStep({required this.controller, required this.now});
  final SendMoneyController controller;
  final DateTime Function() now;

  @override
  State<_ReviewStep> createState() => _ReviewStepState();
}

class _ReviewStepState extends State<_ReviewStep> {
  late final TextEditingController _reference = TextEditingController(
    text: widget.controller.reference,
  );
  String? _referenceError;

  @override
  void dispose() {
    _reference.dispose();
    super.dispose();
  }

  void _confirm() {
    final reference = _reference.text.trim();
    if (reference.isNotEmpty &&
        !RegExp(r'^[A-Za-z0-9 .,/-]{1,35}$').hasMatch(reference)) {
      setState(
        () => _referenceError =
            'Use up to 35 letters, numbers, spaces and . , / - only',
      );
      return;
    }
    setState(() => _referenceError = null);
    widget.controller.setReference(reference);
    widget.controller.confirm();
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final quote = c.quote;
    final recipient = c.recipient;
    if (quote == null || recipient == null) return const SizedBox.shrink();
    final form = c.transferForm;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AaminTicket(
          bandGradient: AaminTicket.split,
          top: TicketRoute(
            from: quote.source.currency,
            to: quote.target.currency,
            fromCaption: 'You send',
            toCaption: 'They get',
          ),
          stub: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${recipient.displayName} gets',
                key: const Key('review_they_get'),
                style: AlmaPayText.ui(
                  size: 13,
                  weight: 500,
                  color: AlmaPayColours.ink2,
                ),
              ),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(
                  quote.target.label,
                  style: AlmaPayText.display.copyWith(fontSize: 44),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        QuoteBreakdown(quote: quote, showTotal: false),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
          decoration: BoxDecoration(
            color: AlmaPayColours.blueSoft,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            key: const Key('review_you_pay'),
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                'Total to pay',
                style: AlmaPayText.ui(size: 15, weight: 600),
              ),
              const SizedBox(width: 12),
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    quote.totalToPay.label,
                    style: AlmaPayText.display.copyWith(fontSize: 30),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Panel(
          children: [
            AmountRow(label: 'Name', value: recipient.accountHolderName),
            AmountRow(label: 'Account', value: recipient.accountSummary),
            AmountRow(label: 'Country', value: recipient.country),
            if (form != null)
              for (final field in form.fields)
                if (c.answers[field.key] != null)
                  AmountRow(
                    label: field.label,
                    value:
                        field.options
                            .where((o) => o.value == c.answers[field.key])
                            .map((o) => o.label)
                            .firstOrNull ??
                        c.answers[field.key]!,
                  ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          key: const Key('review_reference'),
          controller: _reference,
          maxLength: 35,
          decoration: InputDecoration(
            labelText: 'Reference for the recipient (optional)',
            helperText: 'They see this on their bank statement',
            errorText: _referenceError,
            errorMaxLines: 2,
          ),
        ),
        const SizedBox(height: 8),
        Center(
          child: QuoteCountdown(
            quote: quote,
            now: widget.now,
            onExpired: c.renewQuote,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'After you confirm, we will show you how to pay ${c.providerName}. '
          'Your money goes directly to them, not to AaminPay.',
          textAlign: TextAlign.center,
          style: AlmaPayText.ui(size: 13.5, color: AlmaPayColours.ink2),
        ),
        const SizedBox(height: 16),
        PrimaryButton(
          key: const Key('review_confirm'),
          label: 'Confirm and send',
          onPressed: c.busy || c.quoting ? null : _confirm,
        ),
      ],
    );
  }
}
