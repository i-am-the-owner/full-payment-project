import 'package:flutter/material.dart';

import '../../../shared/theme/almapay_theme.dart';

/// The documents the identity check can use.
enum IdDocument {
  passport('Passport', Icons.menu_book_outlined, false),
  drivingLicence('Driving licence', Icons.badge_outlined, true),
  nationalId('National ID card', Icons.credit_card_outlined, true),
  residencePermit('Residence permit', Icons.contact_page_outlined, true);

  const IdDocument(this.label, this.icon, this.hasBack);
  final String label;
  final IconData icon;

  /// Whether the document has a back side to photograph too.
  final bool hasBack;
}

/// Choose which document to use and see where its photos will go.
///
/// This screen is ready on the app side only. Photos are not sent anywhere
/// yet: the identity check itself is carried out by our licensed payment
/// partner, and AaminPay never marks anyone as verified.
class IdentityCheckPage extends StatefulWidget {
  const IdentityCheckPage({required this.verified, super.key});

  /// True when the payment partner has already verified the customer.
  final bool verified;

  @override
  State<IdentityCheckPage> createState() => _IdentityCheckPageState();
}

class _IdentityCheckPageState extends State<IdentityCheckPage> {
  IdDocument _document = IdDocument.passport;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Scaffold(
      appBar: AppBar(title: const Text('Identity check')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(22, 8, 22, 28),
        children: [
          _StatusCard(verified: widget.verified),
          const SizedBox(height: 24),
          Text(
            'Choose your document',
            style: AlmaPayText.ui(size: 16, weight: 600),
          ),
          const SizedBox(height: 4),
          Text(
            'Use a document that is valid and shows your full name and date '
            'of birth.',
            style: AlmaPayText.ui(size: 13.5, color: p.muted),
          ),
          const SizedBox(height: 12),
          for (final doc in IdDocument.values)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _DocumentTile(
                document: doc,
                selected: doc == _document,
                onTap: () => setState(() => _document = doc),
              ),
            ),
          const SizedBox(height: 14),
          Text('Add photos', style: AlmaPayText.ui(size: 16, weight: 600)),
          const SizedBox(height: 12),
          _UploadTile(
            key: const Key('upload_front'),
            title: _document == IdDocument.passport
                ? 'Photo page'
                : 'Front of the document',
          ),
          if (_document.hasBack) ...[
            const SizedBox(height: 10),
            const _UploadTile(
              key: Key('upload_back'),
              title: 'Back of the document',
            ),
          ],
          const SizedBox(height: 24),
          const FilledButton(
            key: Key('identity_continue'),
            // Not connected yet: nothing can be sent from this screen.
            onPressed: null,
            child: Text('Continue'),
          ),
          const SizedBox(height: 12),
          Text(
            'Uploading is not switched on yet. Your identity is checked '
            'securely by our payment partner, and your documents are never '
            'kept in the app.',
            textAlign: TextAlign.center,
            style: AlmaPayText.ui(size: 13, color: p.muted),
          ),
        ],
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.verified});
  final bool verified;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final colour = verified ? AlmaPayColours.ok : p.accent;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: colour.withValues(alpha: 0.14),
              shape: BoxShape.circle,
            ),
            child: Icon(
              verified ? Icons.verified_user : Icons.shield_outlined,
              color: colour,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  verified ? 'Identity verified' : 'Verify your identity',
                  key: const Key('identity_status'),
                  style: AlmaPayText.ui(size: 16.5, weight: 600),
                ),
                const SizedBox(height: 2),
                Text(
                  verified
                      ? 'You can send money.'
                      : 'We need this before you can send money.',
                  style: AlmaPayText.ui(size: 13.5, color: p.muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DocumentTile extends StatelessWidget {
  const _DocumentTile({
    required this.document,
    required this.selected,
    required this.onTap,
  });

  final IdDocument document;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Semantics(
      button: true,
      selected: selected,
      label: document.label,
      excludeSemantics: true,
      child: Material(
        color: p.surface,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          key: Key('document_${document.name}'),
          borderRadius: BorderRadius.circular(18),
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 60),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: selected ? p.accent : p.line,
                width: selected ? 2 : 1.5,
              ),
            ),
            child: Row(
              children: [
                Icon(document.icon, color: selected ? p.accent : p.muted),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(
                    document.label,
                    style: AlmaPayText.ui(size: 15.5, weight: 600),
                  ),
                ),
                Icon(
                  selected
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  color: selected ? p.accent : AlmaPayColours.faint,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A place for a photo. Switched off until uploading is connected.
class _UploadTile extends StatelessWidget {
  const _UploadTile({required this.title, super.key});
  final String title;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Container(
      constraints: const BoxConstraints(minHeight: 72),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: p.line, width: 1.5),
      ),
      child: Row(
        children: [
          Icon(Icons.add_a_photo_outlined, color: p.muted),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AlmaPayText.ui(size: 15, weight: 600)),
                Text(
                  'Opens soon',
                  style: AlmaPayText.ui(size: 12.5, color: p.muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
