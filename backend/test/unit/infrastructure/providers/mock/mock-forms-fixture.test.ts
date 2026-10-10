import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mockFormsFixture } from '../../../../../scripts/export-mock-forms.ts';

const FIXTURE = fileURLToPath(
  new URL('../../../../../../mobile/test/fixtures/mock_forms.json', import.meta.url),
);

test('the forms the mobile renderer is tested against are the mock provider’s current forms', () => {
  const stored: unknown = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.deepEqual(
    stored,
    JSON.parse(JSON.stringify(mockFormsFixture())),
    'Run: node scripts/export-mock-forms.ts > ../mobile/test/fixtures/mock_forms.json',
  );
});
