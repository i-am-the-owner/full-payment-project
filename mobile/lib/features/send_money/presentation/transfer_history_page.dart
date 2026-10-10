import 'package:flutter/material.dart';

import '../../../shared/theme/almapay_theme.dart';
import '../../../shared/widgets/transfer_ticket.dart';
import '../domain/models.dart';
import 'send_money_controller.dart';
import 'send_money_flow_page.dart';
import 'status_style.dart';
import 'widgets/banners.dart';

/// The customer's past transfers, newest first, a page at a time. Everything
/// comes from the backend's own record; opening one shows its timeline.
class TransferHistoryPage extends StatefulWidget {
  const TransferHistoryPage({
    required this.controller,
    this.devTools = false,
    this.embedded = false,
    super.key,
  });

  final SendMoneyController controller;
  final bool devTools;

  /// Drawn inside a tab: a big title instead of an app bar.
  final bool embedded;

  @override
  State<TransferHistoryPage> createState() => _TransferHistoryPageState();
}

class _TransferHistoryPageState extends State<TransferHistoryPage> {
  final List<Transfer> _transfers = [];
  int _page = 0;
  bool _hasMore = true;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadMore();
  }

  Future<void> _loadMore() async {
    if (_loading || !_hasMore) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final page = await widget.controller.loadHistory(_page + 1);
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (page == null) {
        _error = widget.controller.error ?? 'We could not load your transfers.';
      } else {
        _page = page.page;
        _hasMore = page.hasMore;
        _transfers.addAll(page.transfers);
      }
    });
  }

  Future<void> _reload() async {
    setState(() {
      _transfers.clear();
      _page = 0;
      _hasMore = true;
    });
    await _loadMore();
  }

  Future<void> _open(Transfer transfer) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SendMoneyFlowPage(
          controller: widget.controller,
          openTransfer: transfer,
          devTools: widget.devTools,
        ),
      ),
    );
    // Its status may have changed while it was open.
    if (mounted) await _reload();
  }

  (Color, Color) _badgeColours(TransferStatus s) => switch (s) {
    TransferStatus.completed => (AlmaPayColours.okSoft, AlmaPayColours.ok),
    TransferStatus.failed ||
    TransferStatus.cancelled ||
    TransferStatus.refunded => (AlmaPayColours.badSoft, AlmaPayColours.refused),
    TransferStatus.draft || TransferStatus.awaitingFunds => (
      AlmaPayColours.blueSoft,
      AlmaPayColours.blue,
    ),
    _ => (AlmaPayColours.waitSoft, AlmaPayColours.wait),
  };

  @override
  Widget build(BuildContext context) {
    final list = ListView(
      padding: EdgeInsets.fromLTRB(16, widget.embedded ? 4 : 8, 16, 16),
      children: [
        if (widget.embedded)
          Padding(
            padding: const EdgeInsets.fromLTRB(6, 4, 6, 14),
            child: Text(
              'TRANSFERS',
              style: AlmaPayText.display.copyWith(fontSize: 40),
            ),
          ),
        if (_error != null) MessageBanner(text: _error!, isError: true),
        if (_transfers.isEmpty && !_loading && _error == null)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Text('You have not sent any money yet.'),
          ),
        for (final t in _transfers)
          Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: Semantics(
              button: true,
              child: TransferTicket(
                key: Key('history_${t.id}'),
                compact: true,
                fromCurrency: t.source.currency,
                toCurrency: t.target.currency,
                fromCaption: formatDate(t.createdAt),
                toCaption: widget.controller.recipientNameFor(t) ?? t.reference,
                detail: 'You paid ${t.totalToPay.label}',
                label: widget.controller.recipientNameFor(t) ?? t.reference,
                amount: t.target.label,
                badge: badgeText(t.status),
                badgeColours: _badgeColours(t.status),
                bandColour: statusBand(t.status),
                onBandColour: onStatusBand(t.status),
                onTap: () => _open(t),
              ),
            ),
          ),
        if (_loading)
          const Padding(
            padding: EdgeInsets.all(16),
            child: Center(child: CircularProgressIndicator()),
          ),
        if (_hasMore && !_loading && _transfers.isNotEmpty)
          SecondaryButton(
            key: const Key('history_more'),
            label: 'Show older transfers',
            onPressed: _loadMore,
          ),
        if (_error != null)
          SecondaryButton(
            key: const Key('history_retry'),
            label: 'Try again',
            onPressed: _loadMore,
          ),
      ],
    );
    if (widget.embedded) return SafeArea(bottom: false, child: list);
    return Scaffold(
      appBar: AppBar(title: const Text('Your transfers')),
      body: SafeArea(child: list),
    );
  }
}
