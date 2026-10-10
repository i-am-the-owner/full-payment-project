import type {
  DynamicForm,
  FormField,
  FormGroup,
  FormValues,
} from '../../../domain/payout/models.ts';

/**
 * Converts Airwallex's beneficiary form schema
 * (`POST /api/v1/beneficiary_form_schemas/generate`) into SomPay's
 * `DynamicForm`, and form values back into the nested beneficiary object.
 *
 * A form field's key is the schema's dotted `path`
 * (e.g. `beneficiary.bank_details.account_number`), so values map straight
 * back onto the request body without this adapter knowing any field names.
 */

interface SchemaOption {
  label?: unknown;
  value?: unknown;
}
interface SchemaField {
  enabled?: unknown;
  path?: unknown;
  required?: unknown;
  field?: {
    key?: unknown;
    label?: unknown;
    type?: unknown;
    refresh?: unknown;
    example?: unknown;
    options?: SchemaOption[];
  };
  rule?: { pattern?: unknown };
}

/** The fields this adapter fills in itself from the currency and country asked for. */
export const FIXED_PATHS = new Set([
  'beneficiary.bank_details.account_currency',
  'beneficiary.bank_details.bank_country_code',
]);

const GROUP_LABELS: Record<string, string> = {
  bank_details: 'Bank account',
  address: 'Address',
  additional_info: 'Additional information',
  recipient: 'Recipient',
  transfer: 'Transfer',
};

function groupOf(path: string): string {
  const parts = path.split('.');
  if (parts[0] !== 'beneficiary') return 'transfer';
  return parts.length > 2 ? (parts[1] ?? 'recipient') : 'recipient';
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function toDynamicForm(schema: unknown): DynamicForm {
  const fields: FormField[] = [];
  const raw = (schema as { fields?: SchemaField[] } | undefined)?.fields ?? [];

  for (const item of raw) {
    const key = text(item.path) ?? text(item.field?.key);
    if (!key || item.enabled === false || FIXED_PATHS.has(key)) {
      continue;
    }
    const type = text(item.field?.type) ?? 'INPUT';
    const options = (item.field?.options ?? [])
      .map((option) => ({ value: text(option.value), label: text(option.label) }))
      .filter((option): option is { value: string; label: string | undefined } =>
        Boolean(option.value),
      )
      .map((option) => ({ value: option.value, label: option.label ?? option.value }));
    // SELECT / RADIO / TRANSFER_METHOD carry their choices. DYNAMIC_SELECT needs
    // further lookups this adapter does not make, so it is a free-text field
    // validated by Airwallex on submission.
    const isSelect = options.length > 0 && type !== 'INPUT' && type !== 'DYNAMIC_SELECT';
    const pattern = text(item.rule?.pattern);

    fields.push({
      key,
      label: text(item.field?.label) ?? key,
      type: isSelect ? 'select' : 'text',
      required: item.required === true,
      group: groupOf(key),
      // For a select the pattern is just the list of choices again.
      validation: !isSelect && pattern ? { pattern: anchored(pattern) } : {},
      ...(isSelect ? { options } : {}),
      refreshOnChange: item.field?.refresh === true,
      ...(text(item.field?.example) ? { example: text(item.field?.example) } : {}),
    } as FormField);
  }

  const groups: FormGroup[] = [];
  for (const field of fields) {
    if (!groups.some((group) => group.key === field.group)) {
      groups.push({ key: field.group, label: GROUP_LABELS[field.group] ?? field.group });
    }
  }
  return { groups, fields };
}

/** Airwallex patterns are not always anchored; a form rule must match the whole value. */
function anchored(pattern: string): string {
  return pattern.startsWith('^') && pattern.endsWith('$') ? pattern : `^(?:${pattern})$`;
}

/**
 * Builds a nested object from dotted keys:
 * `{ 'beneficiary.bank_details.iban': 'X' }` -> `{ beneficiary: { bank_details: { iban: 'X' } } }`.
 * Keys with unsafe segments are ignored.
 */
export function nestValues(values: FormValues): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const parts = key.split('.');
    if (value === '' || parts.some((part) => !/^[a-z][a-z0-9_]*$/.test(part))) {
      continue;
    }
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      if (typeof next !== 'object' || next === null) {
        node[part] = {};
      }
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]!] = value;
  }
  return root;
}

/** Every `account_currency` the schema says it accepts. */
export function currenciesFromSchema(schema: unknown): string[] {
  const raw = (schema as { fields?: SchemaField[] } | undefined)?.fields ?? [];
  const field = raw.find((item) => item.path === 'beneficiary.bank_details.account_currency');
  const fromOptions = (field?.field?.options ?? [])
    .map((option) => text(option.value))
    .filter((code): code is string => code !== undefined);
  const fromPattern = (text(field?.rule?.pattern) ?? '').split('|');
  return [...new Set([...fromOptions, ...fromPattern])].filter((code) => /^[A-Z]{3}$/.test(code));
}
