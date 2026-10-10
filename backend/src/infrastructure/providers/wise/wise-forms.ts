import type {
  DynamicForm,
  FormField,
  FormFieldType,
  FormGroup,
  FormValues,
} from '../../../domain/payout/models.ts';
import type { WiseRequirementField, WiseRequirementGroup } from './wise-models.ts';

/** The form field that picks which kind of account the recipient has (`iban`, `sort_code`, ...). */
export const ACCOUNT_TYPE_KEY = 'recipientAccountType';
/** Recipient's name: Wise takes it at the top level of the request, not in `details`. */
export const ACCOUNT_HOLDER_KEY = 'accountHolderName';

const TYPE_LABEL = 'How will they receive the money?';

function fieldType(wise: WiseRequirementField): FormFieldType {
  if (wise.valuesAllowed) {
    return wise.type === 'radio' ? 'radio' : 'select';
  }
  return wise.type === 'date' ? 'date' : 'text';
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'details'
  );
}

function toField(wise: WiseRequirementField, group: string): FormField {
  return {
    key: wise.key,
    label: wise.name,
    type: fieldType(wise),
    required: wise.required,
    group,
    validation: {
      ...(wise.validationRegexp ? { pattern: wise.validationRegexp } : {}),
      ...(wise.minLength !== undefined ? { minLength: wise.minLength } : {}),
      ...(wise.maxLength !== undefined ? { maxLength: wise.maxLength } : {}),
    },
    ...(wise.valuesAllowed
      ? { options: wise.valuesAllowed.map((v) => ({ value: v.key, label: v.name })) }
      : {}),
    refreshOnChange: wise.refreshRequirementsOnChange,
    ...(wise.example ? { example: wise.example } : {}),
  };
}

/**
 * Turns one recipient account type's Wise requirements into a
 * {@link DynamicForm}. Wise's own groups, types, rules and
 * `refreshRequirementsOnChange` flags are kept as they are.
 */
function sectionsToForm(group: WiseRequirementGroup): { groups: FormGroup[]; fields: FormField[] } {
  const groups: FormGroup[] = [];
  const fields: FormField[] = [];
  group.sections.forEach((section, index) => {
    if (section.fields.length === 0) {
      return;
    }
    const key = `${slug(section.name || group.title)}_${index}`;
    groups.push({ key, label: section.name });
    for (const field of section.fields) {
      // A field Wise lists twice (it can appear under several account types) is shown once.
      if (!fields.some((existing) => existing.key === field.key)) {
        fields.push(toField(field, key));
      }
    }
  });
  return { groups, fields };
}

/**
 * The recipient form for the chosen account type. The type itself is a field
 * (`recipientAccountType`) flagged `refreshOnChange`, so choosing another type
 * fetches that type's fields. The recipient's name is always present.
 */
export function recipientForm(
  requirements: readonly WiseRequirementGroup[],
  chosenType: string,
): DynamicForm {
  const chosen = requirements.find((r) => r.type === chosenType) ?? requirements[0];
  const body = chosen ? sectionsToForm(chosen) : { groups: [], fields: [] };

  const typeGroup: FormGroup = { key: 'account_type', label: 'Bank account' };
  const typeField: FormField = {
    key: ACCOUNT_TYPE_KEY,
    label: TYPE_LABEL,
    type: 'select',
    required: true,
    group: typeGroup.key,
    validation: {},
    options: requirements.map((r) => ({ value: r.type, label: r.title })),
    refreshOnChange: true,
  };
  const fields = [typeField, ...body.fields];
  // Wise returns the name field only for some currencies; the recipient always needs one.
  if (!fields.some((f) => f.key === ACCOUNT_HOLDER_KEY)) {
    const nameGroup: FormGroup = { key: 'account_holder', label: 'Account holder' };
    body.groups.unshift(nameGroup);
    fields.push({
      key: ACCOUNT_HOLDER_KEY,
      label: 'Full name of the account holder',
      type: 'text',
      required: true,
      group: nameGroup.key,
      validation: { minLength: 2, maxLength: 140 },
      refreshOnChange: false,
    });
  }
  return { groups: [typeGroup, ...body.groups], fields };
}

/** A transfer form (Wise's transfer requirements): all sections of the first group. */
export function transferForm(requirements: readonly WiseRequirementGroup[]): DynamicForm {
  const first = requirements[0];
  return first ? sectionsToForm(first) : { groups: [], fields: [] };
}

/**
 * `{ 'address.country': 'DE', iban: 'DE89…' }` → `{ address: { country: 'DE' }, iban: 'DE89…' }`.
 * Wise keys nested fields with dots. Empty values are dropped.
 */
export function nestDetails(
  values: FormValues,
  exclude: readonly string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (exclude.includes(key) || value.trim() === '') {
      continue;
    }
    const path = key.split('.');
    let cursor = out;
    for (const part of path.slice(0, -1)) {
      if (typeof cursor[part] !== 'object' || cursor[part] === null) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[path[path.length - 1]!] = value.trim();
  }
  return out;
}

/** What a recipient request carries: the type, the name and the rest as `details`. */
export function recipientRequest(values: FormValues): {
  type: string | undefined;
  accountHolderName: string;
  details: Record<string, unknown>;
} {
  return {
    type: values[ACCOUNT_TYPE_KEY]?.trim() || undefined,
    accountHolderName: values[ACCOUNT_HOLDER_KEY]?.trim() ?? '',
    details: nestDetails(values, [ACCOUNT_TYPE_KEY, ACCOUNT_HOLDER_KEY]),
  };
}
