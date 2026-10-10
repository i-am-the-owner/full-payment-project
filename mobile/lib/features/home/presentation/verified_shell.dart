import 'package:flutter/material.dart';

import '../../../app/environment/app_config.dart';
import '../../../shared/theme/almapay_theme.dart';
import '../../../shared/widgets/aamin_mark.dart';
import '../../../shared/widgets/aamin_ticket.dart';
import '../../../shared/widgets/person_row.dart';
import '../../../shared/widgets/transfer_ticket.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../legal/presentation/legal_pages.dart';
import '../../security/biometric_lock.dart';
import '../../send_money/domain/models.dart';
import '../../send_money/presentation/send_money_controller.dart';
import '../../send_money/presentation/send_money_flow_page.dart';
import '../../send_money/presentation/status_style.dart';
import '../../send_money/presentation/transfer_history_page.dart';

/// What a verified customer sees: Home, People, Transfers and You, with the
/// design's bottom bar. Everything shown comes from the backend; nothing here
/// is a sample.
class VerifiedShell extends StatefulWidget {
  const VerifiedShell({
    required this.auth,
    required this.config,
    required this.sendMoney,
    this.biometrics,
    super.key,
  });

  final AuthController auth;
  final AppConfig config;
  final SendMoneyController sendMoney;
  final BiometricLockController? biometrics;

  @override
  State<VerifiedShell> createState() => _VerifiedShellState();
}

class _VerifiedShellState extends State<VerifiedShell> {
  int _tab = 0;

  /// Bumped when Home or Transfers is opened, so they re-read the backend.
  int _gen = 0;

  void _send() => Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => SendMoneyFlowPage(
        controller: widget.sendMoney,
        devTools: !widget.config.isProduction,
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final pages = [
      _HomeTab(
        key: ValueKey('home_$_gen'),
        auth: widget.auth,
        sendMoney: widget.sendMoney,
        config: widget.config,
        onSend: _send,
        onSeeAll: () => setState(() {
          _gen++;
          _tab = 2;
        }),
      ),
      _PeopleTab(sendMoney: widget.sendMoney),
      // A fresh list each time the tab is opened.
      TransferHistoryPage(
        key: ValueKey('history_$_gen'),
        controller: widget.sendMoney,
        devTools: !widget.config.isProduction,
        embedded: true,
      ),
      _YouTab(
        auth: widget.auth,
        config: widget.config,
        biometrics: widget.biometrics,
      ),
    ];
    return Scaffold(
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() {
          if (i != _tab && (i == 0 || i == 2)) _gen++;
          _tab = i;
        }),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home_filled),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.people_outline),
            selectedIcon: Icon(Icons.people),
            label: 'People',
          ),
          NavigationDestination(
            icon: Icon(Icons.confirmation_number_outlined),
            selectedIcon: Icon(Icons.confirmation_number),
            label: 'Transfers',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'You',
          ),
        ],
      ),
    );
  }
}

// --- Home --------------------------------------------------------------------

class _HomeTab extends StatefulWidget {
  const _HomeTab({
    required this.auth,
    required this.sendMoney,
    required this.config,
    required this.onSend,
    required this.onSeeAll,
    super.key,
  });

  final AuthController auth;
  final SendMoneyController sendMoney;
  final AppConfig config;
  final VoidCallback onSend;
  final VoidCallback onSeeAll;

  @override
  State<_HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<_HomeTab> {
  List<Transfer> _recent = const [];

  @override
  void initState() {
    super.initState();
    _loadRecent();
  }

  Future<void> _loadRecent() async {
    final page = await widget.sendMoney.loadHistory(1);
    if (!mounted || page == null) return;
    setState(() => _recent = page.transfers.take(3).toList());
  }

  @override
  Widget build(BuildContext context) {
    final email = widget.auth.user?.email;
    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(22, 10, 22, 20),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'HELLO',
                  style: AlmaPayText.display.copyWith(fontSize: 40),
                ),
              ),
              const AaminMark(size: 32),
            ],
          ),
          if (email != null)
            Padding(
              padding: const EdgeInsets.only(top: 2, bottom: 12),
              child: Text(
                'Signed in as $email',
                key: const Key('signed_in_as'),
                style: AlmaPayText.ui(size: 13.5, color: AlmaPayColours.ink2),
              ),
            ),
          AaminTicket(
            topHeight: 66,
            topPadding: EdgeInsets.zero,
            stubPadding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
            bandGradient: AaminTicket.split,
            top: Row(
              children: [
                _half('You send', Alignment.centerLeft),
                _half('They receive', Alignment.centerRight),
              ],
            ),
            stub: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'See the exact price',
                        style: AlmaPayText.ui(
                          size: 13,
                          weight: 500,
                          color: AlmaPayColours.ink2,
                        ),
                      ),
                      Text(
                        'Before you pay',
                        style: AlmaPayText.display.copyWith(fontSize: 30),
                      ),
                    ],
                  ),
                ),
                FilledButton(
                  key: const Key('verified_send_money'),
                  onPressed: widget.onSend,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(96, 44),
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                  ),
                  child: const Text('Send'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 22),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Recent transfers',
                  style: AlmaPayText.ui(size: 16, weight: 600),
                ),
              ),
              TextButton(
                key: const Key('verified_view_transfers'),
                onPressed: widget.onSeeAll,
                child: const Text('See all'),
              ),
            ],
          ),
          if (_recent.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                'You have not sent any money yet.',
                style: AlmaPayText.ui(color: AlmaPayColours.ink2),
              ),
            ),
          for (final t in _recent)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: TransferTicket(
                compact: true,
                fromCurrency: t.source.currency,
                toCurrency: t.target.currency,
                fromCaption: formatDate(t.createdAt),
                toCaption: t.recipient?.displayName ?? t.reference,
                detail: 'You paid ${t.totalToPay.label}',
                label: t.reference,
                amount: t.target.label,
                badge: badgeText(t.status),
                badgeColours: _badge(t.status),
                bandColour: statusBand(t.status),
                onBandColour: onStatusBand(t.status),
                onTap: widget.onSeeAll,
              ),
            ),
        ],
      ),
    );
  }

  static (Color, Color) _badge(TransferStatus s) => switch (s) {
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

  Widget _half(String text, Alignment a) => Expanded(
    child: Align(
      alignment: a,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Text(
          text,
          style: AlmaPayText.display.copyWith(
            fontSize: 28,
            color: AlmaPayColours.white,
          ),
        ),
      ),
    ),
  );
}

// --- People ------------------------------------------------------------------

class _PeopleTab extends StatefulWidget {
  const _PeopleTab({required this.sendMoney});
  final SendMoneyController sendMoney;

  @override
  State<_PeopleTab> createState() => _PeopleTabState();
}

class _PeopleTabState extends State<_PeopleTab> {
  @override
  void initState() {
    super.initState();
    widget.sendMoney.loadRecipients();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: ListenableBuilder(
        listenable: widget.sendMoney,
        builder: (context, _) {
          final people = widget.sendMoney.recipients;
          return ListView(
            padding: const EdgeInsets.fromLTRB(22, 10, 22, 20),
            children: [
              Text('PEOPLE', style: AlmaPayText.display.copyWith(fontSize: 40)),
              const SizedBox(height: 14),
              if (people.isEmpty)
                Text(
                  'People you send money to will appear here.',
                  style: AlmaPayText.ui(color: AlmaPayColours.ink2),
                )
              else
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 18),
                  decoration: BoxDecoration(
                    color: AlmaPayColours.white,
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Column(
                    children: [
                      for (var i = 0; i < people.length; i++) ...[
                        if (i > 0) const Divider(),
                        PersonRow(person: people[i]),
                      ],
                    ],
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

// --- You ---------------------------------------------------------------------

class _YouTab extends StatelessWidget {
  const _YouTab({required this.auth, required this.config, this.biometrics});
  final AuthController auth;
  final AppConfig config;
  final BiometricLockController? biometrics;

  void _open(BuildContext context, Widget page) =>
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page));

  @override
  Widget build(BuildContext context) {
    final user = auth.user;
    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(22, 10, 22, 20),
        children: [
          Text('YOU', style: AlmaPayText.display.copyWith(fontSize: 40)),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 4),
            decoration: BoxDecoration(
              color: AlmaPayColours.white,
              borderRadius: BorderRadius.circular(24),
            ),
            child: Column(
              children: [
                _kv('Email', user?.email ?? ''),
                const Divider(),
                _kv('Support', config.supportEmail),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (biometrics case final lock? when lock.available)
            ListenableBuilder(
              listenable: lock,
              builder: (context, _) => Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Material(
                  color: AlmaPayColours.white,
                  borderRadius: BorderRadius.circular(24),
                  clipBehavior: Clip.antiAlias,
                  child: SwitchListTile(
                    key: const Key('biometric_switch'),
                    secondary: const Icon(Icons.fingerprint),
                    title: const Text('Unlock with fingerprint'),
                    value: lock.enabled,
                    onChanged: lock.setEnabled,
                  ),
                ),
              ),
            ),
          Material(
            color: AlmaPayColours.white,
            borderRadius: BorderRadius.circular(24),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                ListTile(
                  key: const Key('open_terms'),
                  title: const Text('Terms & Conditions'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _open(context, const LegalDocumentPage.terms()),
                ),
                const Divider(height: 1),
                ListTile(
                  key: const Key('open_privacy'),
                  title: const Text('Privacy Policy'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () =>
                      _open(context, const LegalDocumentPage.privacy()),
                ),
                const Divider(height: 1),
                ListTile(
                  key: const Key('open_about'),
                  title: Text('About ${config.appDisplayName}'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () =>
                      _open(context, AboutPage(appName: config.appDisplayName)),
                ),
                const Divider(height: 1),
                ListTile(
                  key: const Key('open_delete_data'),
                  title: const Text('Delete my account / data'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _open(
                    context,
                    DeleteDataPage(
                      supportEmail: config.supportEmail,
                      accountEmail: user?.email ?? '',
                    ),
                  ),
                ),
                const Divider(height: 1),
                ListTile(
                  key: const Key('open_contact'),
                  title: const Text('Contact us'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _open(
                    context,
                    ContactPage(supportEmail: config.supportEmail),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'Payments are provided by our licensed partner. AaminPay never '
            'holds your money.',
            style: AlmaPayText.ui(size: 13.5, color: AlmaPayColours.ink2),
          ),
          const SizedBox(height: 24),
          OutlinedButton.icon(
            key: const Key('sign_out'),
            onPressed: () async {
              await biometrics?.reset();
              await auth.logout();
            },
            icon: const Icon(Icons.logout),
            label: const Text('Sign out'),
          ),
        ],
      ),
    );
  }

  Widget _kv(String k, String v) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 14),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(k, style: AlmaPayText.ui(size: 15.5, color: AlmaPayColours.ink2)),
        const SizedBox(width: 12),
        Flexible(
          child: Text(
            v,
            textAlign: TextAlign.end,
            style: AlmaPayText.ui(size: 15.5, weight: 600),
          ),
        ),
      ],
    ),
  );
}
