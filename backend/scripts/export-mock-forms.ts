/**
 * Writes the mock provider's recipient and transfer forms to a JSON file, as
 * the API would return them. The mobile app's dynamic-form tests render these
 * exact forms, so the renderer is tested against the real mock provider.
 *
 *   node scripts/export-mock-forms.ts > ../mobile/test/fixtures/mock_forms.json
 */
import { recipientForm, transferForm } from '../src/infrastructure/providers/mock/mock-forms.ts';

export const FORM_CURRENCIES = ['EUR', 'USD', 'INR', 'MXN'] as const;

export function mockFormsFixture(): Record<string, unknown> {
  const recipient: Record<string, unknown> = {};
  const transfer: Record<string, unknown> = {};
  for (const currency of FORM_CURRENCIES) {
    recipient[currency] = {
      PRIVATE: recipientForm(currency, { legalType: 'PRIVATE' }),
      BUSINESS: recipientForm(currency, { legalType: 'BUSINESS' }),
    };
    transfer[currency] = transferForm(currency);
  }
  return { recipient, transfer };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(mockFormsFixture(), null, 2)}\n`);
}
