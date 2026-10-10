import 'package:flutter/material.dart';

import '../../../app/environment/app_config.dart';
import '../../../app/theme_mode_controller.dart';
import '../../../shared/theme/almapay_theme.dart';
import '../../../shared/widgets/aamin_mark.dart';
import '../../../shared/widgets/aamin_ticket.dart';
import '../../../shared/widgets/person_row.dart';
import '../../../shared/widgets/transfer_ticket.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../identity/presentation/identity_check_page.dart';
import '../../legal/presentation/legal_pages.dart';
import '../../onboarding/presentation/onboarding_controller.dart';
import '../../security/biometric_lock.dart';
import '../../send_money/domain/models.dart';
import '../../send_money/presentation/send_money_controller.dart';
import '../../send_money/presentation/send_money_flow_page.dart';
import '../../send_money/presentation/status_style.dart';
import '../../send_money/presentation/transfer_history_page.dart';
import '../../send_money/presentation/widgets/currency_picker.dart';

/// What a verified customer sees: Home, People, Transfers and You, with the
/// design's bottom bar. Everything shown comes from the backend; nothing here
/// is a sample.
class VerifiedShell extends StatefulWidget {
  const VerifiedShell({
    required this.auth,
    required this.config,
    required this.sendMoney,
    this.biometrics,
    this.onboarding,
    super.key,
  });

  final OnboardingController? onboarding;
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
        onboarding: widget.onboarding,
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
        onboarding: widget.onboarding,
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
    this.onboarding,
    super.key,
  });

  final OnboardingController? onboarding;

  final AuthController auth;
  final SendMoneyController sendMoney;
  final AppConfig config;
  final VoidCallback onSend;
  final VoidCallback onSeeAll;

  @override
  State<_HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<_HomeTab> {
  /// Stands in when there is no onboarding controller (nothing to listen to).
  static final _noChange = ValueNotifier<int>(0);

  List<Transfer> _recent = const [];

  @override
  void initState() {
    super.initState();
    _loadRecent();
    widget.sendMoney.loadIndicativeRate();
  }

  Future<void> _loadRecent() async {
    final page = await widget.sendMoney.loadHistory(1);
    if (!mounted || page == null) return;
    setState(() => _recent = page.transfers.take(3).toList());
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(22, 10, 22, 20),
        children: [
          ListenableBuilder(
            listenable: widget.onboarding ?? _noChange,
            builder: (context, _) {
              final name = widget.onboarding?.firstName;
              return Row(
                children: [
                  Expanded(
                    child: Text(
                      name == null
                          ? 'WELCOME'
                          : 'WELCOME, ${name.toUpperCase()}',
                      key: const Key('welcome_heading'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AlmaPayText.display.copyWith(fontSize: 28),
                    ),
                  ),
                  const AaminMark(size: 32),
                ],
              );
            },
          ),
          const SizedBox(height: 12),
          ListenableBuilder(
            listenable: widget.sendMoney,
            builder: (context, _) {
              final sm = widget.sendMoney;
              final rate = sm.indicativeRate;
              return AaminTicket(
                topHeight: 84,
                topPadding: EdgeInsets.zero,
                stubPadding: const EdgeInsets.fromLTRB(20, 16, 20, 18),
                bandGradient: AaminTicket.split,
                top: Row(
                  children: [
                    Expanded(
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Padding(
                          padding: const EdgeInsets.only(left: 12),
                          child: _pair(
                            'Country you send from',
                            sm.sourceCurrency,
                            sm.sourceCurrencies,
                            (c) {
                              sm.setSourceCurrency(c);
                              sm.loadIndicativeRate();
                            },
                          ),
                        ),
                      ),
                    ),
                    const Icon(
                      Icons.arrow_forward,
                      color: AlmaPayColours.white,
                    ),
                    Expanded(
                      child: Align(
                        alignment: Alignment.centerRight,
                        child: Padding(
                          padding: const EdgeInsets.only(right: 12),
                          child: _pair(
                            'Country you send to',
                            sm.targetCurrency,
                            sm.targetCurrencies,
                            (c) {
                              sm.setTargetCurrency(c);
                              sm.loadIndicativeRate();
                            },
                          ),
                        ),
                      ),
                    ),
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
                            rate == null
                                ? 'See the exact price'
                                : 'Exchange rate',
                            style: AlmaPayText.ui(
                              size: 14,
                              weight: 500,
                              color: context.palette.muted,
                            ),
                          ),
                          FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerLeft,
                            child: Text(
                              rate ?? 'Before you pay',
                              key: const Key('home_exchange_rate'),
                              maxLines: 1,
                              style: AlmaPayText.display.copyWith(fontSize: 34),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    FilledButton(
                      key: const Key('verified_send_money'),
                      onPressed: widget.onSend,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(110, 50),
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                      ),
                      child: const Text('Send'),
                    ),
                  ],
                ),
              );
            },
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
                style: AlmaPayText.ui(color: context.palette.muted),
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

  Widget _pair(
    String label,
    String? selected,
    List<String> codes,
    ValueChanged<String> onSelected,
  ) => CurrencyPickerButton(
    label: label,
    selected: selected,
    codes: codes,
    currencies: widget.sendMoney.currencies,
    onSelected: onSelected,
    codeSize: 30,
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
                  style: AlmaPayText.ui(color: context.palette.muted),
                )
              else
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 18),
                  decoration: BoxDecoration(
                    color: context.palette.surface,
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
  const _YouTab({
    required this.auth,
    required this.config,
    this.biometrics,
    this.onboarding,
  });
  final AuthController auth;
  final AppConfig config;
  final BiometricLockController? biometrics;
  final OnboardingController? onboarding;

  void _open(BuildContext context, Widget page) =>
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page));

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final user = auth.user;
    final name = onboarding?.firstName;
    final theme = ThemeScope.maybeOf(context);
    return SafeArea(
      bottom: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(22, 10, 22, 28),
        children: [
          Text('YOU', style: AlmaPayText.display.copyWith(fontSize: 34)),
          const SizedBox(height: 16),
          _ProfileHeader(name: name, email: user?.email ?? ''),
          const _SectionLabel('Account'),
          _Group(
            children: [
              ListTile(
                key: const Key('open_identity'),
                leading: const Icon(Icons.verified_user_outlined),
                title: const Text('Identity check'),
                subtitle: const Text('Verified'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () =>
                    _open(context, const IdentityCheckPage(verified: true)),
              ),
              if (biometrics case final lock? when lock.available)
                ListenableBuilder(
                  listenable: lock,
                  builder: (context, _) => SwitchListTile(
                    key: const Key('biometric_switch'),
                    secondary: const Icon(Icons.fingerprint),
                    title: const Text('Unlock with fingerprint'),
                    value: lock.enabled,
                    onChanged: lock.setEnabled,
                  ),
                ),
            ],
          ),
          if (theme != null) ...[
            const _SectionLabel('Appearance'),
            _Group(
              children: [
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: SizedBox(
                    width: double.infinity,
                    child: SegmentedButton<ThemeMode>(
                      key: const Key('theme_mode'),
                      showSelectedIcon: false,
                      segments: const [
                        ButtonSegment(
                          value: ThemeMode.system,
                          icon: Icon(Icons.brightness_auto_outlined),
                          label: Text('Auto'),
                        ),
                        ButtonSegment(
                          value: ThemeMode.light,
                          icon: Icon(Icons.light_mode_outlined),
                          label: Text('Light'),
                        ),
                        ButtonSegment(
                          value: ThemeMode.dark,
                          icon: Icon(Icons.dark_mode_outlined),
                          label: Text('Dark'),
                        ),
                      ],
                      selected: {theme.mode},
                      onSelectionChanged: (s) => theme.setMode(s.first),
                    ),
                  ),
                ),
              ],
            ),
          ],
          const _SectionLabel('Help and legal'),
          _Group(
            children: [
              _linkTile(
                context,
                const Key('open_contact'),
                Icons.mail_outline,
                'Contact us',
                ContactPage(supportEmail: config.supportEmail),
              ),
              _linkTile(
                context,
                const Key('open_about'),
                Icons.info_outline,
                'About ${config.appDisplayName}',
                AboutPage(appName: config.appDisplayName),
              ),
              _linkTile(
                context,
                const Key('open_terms'),
                Icons.description_outlined,
                'Terms & Conditions',
                const LegalDocumentPage.terms(),
              ),
              _linkTile(
                context,
                const Key('open_privacy'),
                Icons.lock_outline,
                'Privacy Policy',
                const LegalDocumentPage.privacy(),
              ),
              _linkTile(
                context,
                const Key('open_delete_data'),
                Icons.delete_outline,
                'Delete my account / data',
                DeleteDataPage(
                  supportEmail: config.supportEmail,
                  accountEmail: user?.email ?? '',
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Text(
            'Payments are provided by our licensed partner. AaminPay never '
            'holds your money.',
            textAlign: TextAlign.center,
            style: AlmaPayText.ui(size: 13, color: p.muted),
          ),
          const SizedBox(height: 22),
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

  Widget _linkTile(
    BuildContext context,
    Key key,
    IconData icon,
    String title,
    Widget page,
  ) => ListTile(
    key: key,
    leading: Icon(icon),
    title: Text(title),
    trailing: const Icon(Icons.chevron_right),
    onTap: () => _open(context, page),
  );
}

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({required this.name, required this.email});
  final String? name;
  final String email;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final initial = (name ?? email).trim().isEmpty
        ? '?'
        : (name ?? email).trim()[0].toUpperCase();
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 28,
            backgroundColor: p.accentSoft,
            child: Text(
              initial,
              style: AlmaPayText.ui(size: 22, weight: 700, color: p.accent),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (name != null)
                  Text(name!, style: AlmaPayText.ui(size: 18, weight: 600)),
                Text(
                  email,
                  overflow: TextOverflow.ellipsis,
                  style: AlmaPayText.ui(size: 14, color: p.muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(6, 24, 6, 8),
    child: Text(
      text.toUpperCase(),
      style: AlmaPayText.ui(
        size: 12,
        weight: 700,
        color: context.palette.muted,
      ).copyWith(letterSpacing: 0.8),
    ),
  );
}

/// Rows in one rounded card, with a divider between them.
class _Group extends StatelessWidget {
  const _Group({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Material(
    color: context.palette.surface,
    borderRadius: BorderRadius.circular(24),
    clipBehavior: Clip.antiAlias,
    child: Column(
      children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) const Divider(height: 1, indent: 16, endIndent: 16),
          children[i],
        ],
      ],
    ),
  );
}
