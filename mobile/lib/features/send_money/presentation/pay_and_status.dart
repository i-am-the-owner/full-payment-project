import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../shared/theme/almapay_theme.dart';
import '../../../shared/widgets/transfer_ticket.dart';
import '../domain/models.dart';
import 'send_money_controller.dart';
import 'status_style.dart';
import 'widgets/amount_row.dart';
import 'widgets/banners.dart';
import 'widgets/transfer_timeline.dart';

// --- 5. Pay ----------------------------------------------------------------

/// Shows how to pay the provider for the transfer: the provider's bank
/// details and reference, with copy buttons, or the customer's own balance at
/// the provider. The money goes to the provider – never to AaminPay.
class PayStep extends StatelessWidget {
  const PayStep({required this.controller, super.key});

  final SendMoneyController controller;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    final transfer = c.transfer;
    final funding = c.funding;
    if (transfer == null) return const SizedBox.shrink();
    final provider = c.providerName;
    final bank = funding?.bankTransfer;
    final balance = funding?.balance;
    final to = (transfer.recipient ?? c.recipient)?.displayName;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const StepHeading('How do you want to pay?'),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
          decoration: BoxDecoration(
            color: context.palette.accentSoft,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Text(
                  to == null ? 'Total to pay' : 'To $to',
                  style: AlmaPayText.ui(size: 15, weight: 600),
                ),
              ),
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    transfer.totalToPay.label,
                    key: const Key('pay_total'),
                    style: AlmaPayText.display.copyWith(fontSize: 32),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (funding == null && !c.busy)
          SecondaryButton(
            key: const Key('pay_reload'),
            label: 'Show how to pay',
            onPressed: c.loadFunding,
          ),
        if (bank != null) ...[
          const _MethodCard(
            icon: Icons.account_balance_outlined,
            title: 'Pay by bank transfer',
            subtitle: 'From your own bank account',
            selected: true,
          ),
          const SizedBox(height: 12),
          Text(
            'Send exactly this amount to $provider using these details. '
            'Include the reference so they can match your payment.',
            style: AlmaPayText.ui(size: 14.5, color: context.palette.muted),
          ),
          const SizedBox(height: 8),
          Panel(
            children: [
              _CopyRow(
                label: 'Amount',
                value: bank.amount.display,
                suffix: bank.amount.currency,
              ),
              for (final detail in bank.bankDetails)
                _CopyRow(label: detail.label, value: detail.value),
              if (bank.reference != null)
                _CopyRow(
                  key: const Key('pay_reference'),
                  label: 'Reference',
                  value: bank.reference!,
                ),
            ],
          ),
          const SizedBox(height: 16),
          PrimaryButton(
            key: const Key('pay_bank_done'),
            label: "I've made the bank transfer",
            onPressed: c.busy ? null : () => c.pay('BANK_TRANSFER'),
          ),
          const SizedBox(height: 16),
        ],
        if (balance != null) ...[
          const _MethodCard(
            icon: Icons.account_balance_wallet_outlined,
            title: 'Pay from your balance',
            subtitle: 'Money you already hold with the payment partner',
            selected: false,
          ),
          const SizedBox(height: 12),
          SecondaryButton(
            key: const Key('pay_balance'),
            label: 'Pay ${balance.amount.label} from my $provider balance',
            onPressed: c.busy ? null : () => c.pay('BALANCE'),
          ),
          const SizedBox(height: 16),
        ],
        TextButton(
          key: const Key('pay_later'),
          onPressed: c.busy ? null : () => c.openTransfer(transfer),
          style: TextButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: const Text('I will pay later'),
        ),
        TextButton(
          key: const Key('pay_cancel'),
          onPressed: c.busy ? null : c.cancelTransfer,
          style: TextButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: const Text('Cancel this transfer'),
        ),
        const SizedBox(height: 8),
        Row(
          key: const Key('pay_explainer'),
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(
                Icons.shield_outlined,
                size: 18,
                color: context.palette.muted,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              // TODO-LEGAL: the lawyer's final wording for the provider
              // statement (and its regulatory status) replaces this text. Keep
              // both facts: the provider supplies the payment service,
              // AaminPay holds no funds.
              child: Text(
                'Your money goes directly to $provider, the regulated company '
                'that carries out your transfer. It does not go to AaminPay, '
                'and AaminPay never holds your money.\n\n'
                'Payments are provided by $provider. AaminPay does not hold '
                'customer funds.',
                key: const Key('pay_provider_statement'),
                style: AlmaPayText.ui(size: 12.5, color: context.palette.muted),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// A payment method as a card: icon, name, a line of detail and a radio.
class _MethodCard extends StatelessWidget {
  const _MethodCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.selected,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: context.palette.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: selected ? AlmaPayColours.blue : context.palette.line,
          width: selected ? 2 : 1.5,
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: context.palette.accentSoft,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: AlmaPayColours.blue),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AlmaPayText.ui(size: 16, weight: 600)),
                Text(
                  subtitle,
                  style: AlmaPayText.ui(
                    size: 13.5,
                    color: context.palette.muted,
                  ),
                ),
              ],
            ),
          ),
          Container(
            width: 22,
            height: 22,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: selected ? AlmaPayColours.blue : AlmaPayColours.faint,
                width: selected ? 7 : 2,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One detail to copy into a banking app, with a button that copies it.
class _CopyRow extends StatelessWidget {
  const _CopyRow({
    required this.label,
    required this.value,
    this.suffix,
    super.key,
  });

  final String label;
  final String value;
  final String? suffix;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: MergeSemantics(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: AlmaPayText.ui(
                      size: 13.5,
                      color: context.palette.muted,
                    ),
                  ),
                  Text(
                    suffix == null ? value : '$value $suffix',
                    style: AlmaPayText.ui(size: 16, weight: 600),
                  ),
                ],
              ),
            ),
          ),
          IconButton(
            key: Key('copy_$label'),
            icon: const Icon(Icons.copy_outlined),
            tooltip: 'Copy ${label.toLowerCase()}',
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: value));
              if (!context.mounted) return;
              ScaffoldMessenger.of(context)
                ..hideCurrentSnackBar()
                ..showSnackBar(SnackBar(content: Text('$label copied')));
            },
          ),
        ],
      ),
    );
  }
}

// --- 6. Status -------------------------------------------------------------

/// The transfer's progress: a timeline, the figures and the recipient. While
/// the transfer is still moving it re-reads the backend's record every few
/// seconds, which is how status changes delivered by provider webhook appear.
class TransferStatusView extends StatefulWidget {
  const TransferStatusView({
    required this.controller,
    this.devTools = false,
    this.pollEvery = const Duration(seconds: 5),
    super.key,
  });

  final SendMoneyController controller;
  final bool devTools;
  final Duration pollEvery;

  @override
  State<TransferStatusView> createState() => _TransferStatusViewState();
}

class _TransferStatusViewState extends State<TransferStatusView> {
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(widget.pollEvery, (_) {
      final transfer = widget.controller.transfer;
      if (transfer != null && !transfer.status.isSettled) {
        widget.controller.reloadTransfer(quiet: true);
      }
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  static String _headline(Transfer t) => switch (t.status) {
    TransferStatus.draft => 'We are setting up your transfer',
    TransferStatus.awaitingFunds => 'Waiting for your money',
    TransferStatus.processing => 'Your transfer is being processed',
    TransferStatus.sent => 'Your money is on its way',
    TransferStatus.completed => 'Your money has been delivered',
    TransferStatus.cancelled => 'This transfer was cancelled',
    TransferStatus.refunded => 'Your money was sent back to you',
    TransferStatus.failed => 'This transfer did not go through',
    TransferStatus.unknown => 'We are checking this transfer',
  };

  /// True when the provider had the customer's money before the transfer
  /// stopped. Read from the backend's own timeline of what the provider said.
  static bool _moneyWasTaken(Transfer t) => t.timeline.any(
    (e) =>
        e.status == TransferStatus.processing ||
        e.status == TransferStatus.sent ||
        e.status == TransferStatus.completed,
  );

  static String? _explain(Transfer t, String provider) => switch (t.status) {
    TransferStatus.draft =>
      'We have not had confirmation from $provider yet. You do not need to '
          'do anything. Nothing has been taken from you.',
    TransferStatus.awaitingFunds =>
      '$provider is waiting for your payment. A bank transfer can take a '
          'few hours to arrive.',
    // After funding: say what happens to the customer's money.
    TransferStatus.failed when _moneyWasTaken(t) =>
      "Sorry, this transfer didn't reach ${t.recipient?.displayName ?? 'your recipient'}. "
          'Your money is not lost: $provider will return your '
          '${t.totalToPay.label} to you. You do not need to do anything. '
          "We've been told about this and we are keeping an eye on it, and "
          'we will email you when your money has been returned.',
    TransferStatus.failed =>
      'No money has been sent to the recipient, and nothing has been taken '
          'from you. If you already paid $provider, they will return it to you.',
    TransferStatus.refunded =>
      '$provider has sent your ${t.totalToPay.label} back. Look for it in '
          'the account you paid from.',
    _ => null,
  };

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final transfer = c.transfer;
    if (transfer == null) return const SizedBox.shrink();
    final provider = c.providerName;
    final recipient = transfer.recipient ?? c.recipient;
    final explain = _explain(transfer, provider);
    final status = transfer.status;
    final back =
        status == TransferStatus.refunded ||
        status == TransferStatus.failed ||
        status == TransferStatus.cancelled;
    final done = status == TransferStatus.completed;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // The ticket changes colour with the step: blue until the money moves,
        // amber on its way, green when it arrives, red (route reversed) if it
        // is coming back.
        TransferTicket(
          fromCurrency: back
              ? transfer.target.currency
              : transfer.source.currency,
          toCurrency: back
              ? transfer.source.currency
              : transfer.target.currency,
          fromCaption: formatDate(transfer.createdAt),
          toCaption: recipient?.displayName,
          label: back
              ? 'Coming back to you'
              : done
              ? '${recipient?.displayName ?? 'Recipient'} got'
              : 'Recipient gets',
          amount: back ? transfer.totalToPay.label : transfer.target.label,
          bandColour: statusBand(status),
          onBandColour: onStatusBand(status),
          stamp: done ? 'Delivered ${formatDate(transfer.createdAt)}' : null,
        ),
        const SizedBox(height: 18),
        StepHeading(_headline(transfer), key: const Key('status_headline')),
        if (explain != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: Text(
              explain,
              style: AlmaPayText.ui(size: 15, color: context.palette.muted),
            ),
          ),
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: context.palette.surface,
            borderRadius: BorderRadius.circular(24),
          ),
          child: TransferTimeline(transfer: transfer),
        ),
        const SizedBox(height: 14),
        Panel(
          children: [
            AmountRow(
              label: 'You pay in total',
              value: transfer.totalToPay.label,
            ),
            AmountRow(label: 'Our fee', value: transfer.fee.label),
            AmountRow(
              label: 'Rate',
              value:
                  '1 ${transfer.source.currency} = ${transfer.exchangeRate} ${transfer.target.currency}',
            ),
            AmountRow(
              label: 'Recipient gets',
              value: transfer.target.label,
              emphasise: true,
            ),
            if (recipient != null) ...[
              AmountRow(label: 'Recipient', value: recipient.displayName),
              AmountRow(label: 'Account', value: recipient.accountSummary),
            ],
            if (transfer.recipientReference != null)
              AmountRow(
                label: 'Reference for recipient',
                value: transfer.recipientReference!,
              ),
            AmountRow(label: 'AaminPay reference', value: transfer.reference),
            AmountRow(
              label: 'Started',
              value: formatDateTime(transfer.createdAt),
            ),
          ],
        ),
        const SizedBox(height: 18),
        if (transfer.status == TransferStatus.awaitingFunds) ...[
          PrimaryButton(
            key: const Key('status_how_to_pay'),
            label: 'How to pay',
            onPressed: c.busy ? null : c.showPayment,
          ),
          const SizedBox(height: 10),
        ],
        if (!transfer.status.isSettled)
          SecondaryButton(
            key: const Key('status_refresh'),
            label: 'Check for updates',
            onPressed: c.busy ? null : c.refreshTransfer,
          ),
        if (transfer.status.isCancellable) ...[
          const SizedBox(height: 8),
          TextButton(
            key: const Key('status_cancel'),
            onPressed: c.busy ? null : c.cancelTransfer,
            style: TextButton.styleFrom(minimumSize: const Size.fromHeight(48)),
            child: const Text('Cancel this transfer'),
          ),
        ],
        if (widget.devTools &&
            c.isMockProvider &&
            !transfer.status.isSettled) ...[
          const SizedBox(height: 8),
          OutlinedButton(
            key: const Key('dev_simulate'),
            onPressed: c.busy ? null : c.simulateProviderStep,
            child: const Text(
              'Test tool: make the mock provider take the next step',
              textAlign: TextAlign.center,
            ),
          ),
        ],
        const SizedBox(height: 8),
        TextButton(
          key: const Key('status_done'),
          onPressed: () => Navigator.of(context).maybePop(),
          style: TextButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: const Text('Done'),
        ),
      ],
    );
  }
}
