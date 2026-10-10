import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../shared/theme/almapay_theme.dart';

class LegalSection {
  const LegalSection(this.heading, this.body);
  final String heading;
  final String body;
}

/// A read-only document. The wording is the same draft as the website's and
/// must be replaced with the lawyer's final text before launch.
class LegalDocumentPage extends StatelessWidget {
  const LegalDocumentPage._({
    required this.title,
    required this.intro,
    required this.sections,
    super.key,
  });

  // TODO-LEGAL: replace with the final terms (company and registered office,
  // the provider's service terms, fees and refunds, complaints and the
  // Financial Ombudsman route, governing law, liability, and the approved
  // 'we do not hold customer funds' statement).
  const LegalDocumentPage.terms({Key? key})
    : this._(
        key: key,
        title: 'Terms & Conditions',
        intro:
            'Draft only. These terms are not in force and will be replaced by '
            'a legally reviewed version before AaminPay launches.',
        sections: _terms,
      );

  // TODO-LEGAL: replace with the final privacy policy (controller identity and
  // ICO number, lawful bases, retention, international transfers, the provider
  // as an independent controller, data-subject rights contact).
  const LegalDocumentPage.privacy({Key? key})
    : this._(
        key: key,
        title: 'Privacy Policy',
        intro:
            'Draft only. This describes how AaminPay intends to handle '
            'personal data and will be finalised with legal advice.',
        sections: _privacy,
      );

  final String title;
  final String intro;
  final List<LegalSection> sections;

  static const _terms = [
    LegalSection(
      'About these terms',
      'These terms will govern your use of the AaminPay app and the '
          'money-transfer service.',
    ),
    LegalSection(
      'Who provides the payment',
      'Payments are provided by our licensed partner, which checks your '
          'identity. AaminPay does not hold your money.',
    ),
    LegalSection(
      'Your account',
      'You are responsible for keeping your login details safe. Tell us '
          'straight away if you think your account has been compromised.',
    ),
    LegalSection(
      'Transfers',
      'Before you confirm, you are shown the exchange rate, the fee and the '
          'amount the recipient gets. A quote is valid for a limited time. '
          'You are responsible for the recipient details you enter. Delivery '
          'times are estimates, not guarantees.',
    ),
    LegalSection(
      'Failed transfers and refunds',
      'If a transfer cannot be completed it is marked as failed, and money '
          'is either not taken or returned.',
    ),
    LegalSection(
      'Acceptable use',
      'You must not use AaminPay for unlawful purposes, including money '
          'laundering, fraud or sanctions evasion. A transfer may be refused '
          'or delayed to meet legal obligations.',
    ),
  ];

  static const _privacy = [
    LegalSection(
      'What we collect',
      'Your name, email and password (stored only as a secure hash); the '
          'identity details needed to verify you; the amounts, currencies and '
          'recipient summaries of your transfers; and technical data used to '
          'keep the service secure.',
    ),
    LegalSection(
      'Why we use it',
      'To provide the transfers you ask for, to meet legal and '
          'financial-crime obligations, to keep your account secure, and to '
          'give you support.',
    ),
    LegalSection(
      'Who we share it with',
      'Our licensed payment partner, which verifies your identity and '
          'carries out your transfers, and others only where the law requires.',
    ),
    LegalSection(
      'Fingerprint unlock',
      'If you turn it on, your fingerprint is checked by your phone. AaminPay '
          'never receives or stores it.',
    ),
    LegalSection(
      'Your rights',
      'You can ask to see, correct or delete your data. Contact us from the '
          'Contact screen.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: ListView(
        padding: const EdgeInsets.all(22),
        children: [
          Text(intro, style: AlmaPayText.ui(color: AlmaPayColours.ink2)),
          for (final s in sections) ...[
            const SizedBox(height: 20),
            Text(s.heading, style: AlmaPayText.ui(size: 16, weight: 600)),
            const SizedBox(height: 6),
            Text(s.body, style: AlmaPayText.ui(size: 14.5)),
          ],
        ],
      ),
    );
  }
}

class ContactPage extends StatelessWidget {
  const ContactPage({required this.supportEmail, super.key});

  final String supportEmail;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Contact us')),
      body: ListView(
        padding: const EdgeInsets.all(22),
        children: [
          Text(
            'Questions about a transfer, your account or your data? Email us '
            'and include your transfer reference if you have one.',
            style: AlmaPayText.ui(color: AlmaPayColours.ink2),
          ),
          const SizedBox(height: 20),
          Card(
            child: ListTile(
              key: const Key('contact_email'),
              leading: const Icon(Icons.email_outlined),
              title: Text(supportEmail),
              subtitle: const Text('Tap to copy'),
              onTap: () async {
                await Clipboard.setData(ClipboardData(text: supportEmail));
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Email address copied')),
                );
              },
            ),
          ),
          const SizedBox(height: 16),
          Text(
            // TODO-LEGAL: company name, registered address and complaints route.
            'Company details and the complaints route will be shown here '
            'before launch.',
            style: AlmaPayText.ui(size: 13.5, color: AlmaPayColours.ink2),
          ),
        ],
      ),
    );
  }
}

/// Asks us to delete the account and its data. There is no button that erases
/// anything: a person at AaminPay handles the request, because some records
/// (transfers, identity checks) must be kept for the time the law requires.
class DeleteDataPage extends StatelessWidget {
  const DeleteDataPage({
    required this.supportEmail,
    required this.accountEmail,
    super.key,
  });

  final String supportEmail;
  final String accountEmail;

  String get _request =>
      'To: $supportEmail\n'
      'Subject: Delete my account and data\n\n'
      'Please delete my AaminPay account and personal data.\n'
      'Account email: $accountEmail';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Delete my account / data')),
      body: ListView(
        padding: const EdgeInsets.all(22),
        children: [
          Text(
            'You can ask us to delete your account and personal data. We will '
            'reply by email to confirm it is you.',
            style: AlmaPayText.ui(color: AlmaPayColours.ink2),
          ),
          const SizedBox(height: 16),
          Text(
            'Some records, such as past transfers and identity checks, have to '
            'be kept for the period the law requires. We delete everything '
            'else, and tell you what we kept and why. Transfers that are still '
            'in progress must finish first.',
            style: AlmaPayText.ui(size: 14.5),
          ),
          const SizedBox(height: 20),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(_request, key: const Key('delete_request_text')),
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            key: const Key('copy_delete_request'),
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: _request));
              if (!context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Copied. Paste it into an email to us.'),
                ),
              );
            },
            icon: const Icon(Icons.copy),
            label: const Text('Copy my request'),
          ),
        ],
      ),
    );
  }
}

class AboutPage extends StatelessWidget {
  const AboutPage({required this.appName, super.key});

  final String appName;

  @override
  Widget build(BuildContext context) {
    // TODO-LEGAL: the approved provider name, company details and wording.
    const items = [
      LegalSection(
        'Who provides the payment',
        'Payments are provided by our licensed partner. It checks your '
            'identity and carries out your transfers.',
      ),
      LegalSection(
        'Your money',
        'We never hold your money. You pay our partner directly, and there is '
            'no balance or wallet with us.',
      ),
      LegalSection(
        'Cookies and tracking',
        'This app does not use advertising cookies or trackers. It keeps '
            'only what it needs to keep you signed in, in your phone\'s '
            'secure storage.',
      ),
    ];
    return Scaffold(
      appBar: AppBar(title: Text('About $appName')),
      body: ListView(
        padding: const EdgeInsets.all(22),
        children: [
          for (final s in items) ...[
            Text(s.heading, style: AlmaPayText.ui(size: 16, weight: 600)),
            const SizedBox(height: 6),
            Text(s.body, style: AlmaPayText.ui(size: 14.5)),
            const SizedBox(height: 20),
          ],
        ],
      ),
    );
  }
}
