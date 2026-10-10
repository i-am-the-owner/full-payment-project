import { ValidationFailedError, type PayoutFieldError } from '../../../domain/payout/errors.ts';
import type { DynamicForm, FormField, FormValues } from '../../../domain/payout/models.ts';

const text = (
  key: string,
  label: string,
  group: string,
  validation: FormField['validation'],
  extra: Partial<FormField> = {},
): FormField => ({
  key,
  label,
  type: 'text',
  required: true,
  group,
  validation,
  refreshOnChange: false,
  ...extra,
});

const select = (
  key: string,
  label: string,
  group: string,
  options: [string, string][],
  extra: Partial<FormField> = {},
): FormField => ({
  key,
  label,
  type: 'select',
  required: true,
  group,
  validation: {},
  options: options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
  refreshOnChange: false,
  ...extra,
});

/** Where each mock currency can be paid out. */
export const COUNTRIES_BY_CURRENCY: Readonly<Record<string, readonly string[]>> = {
  GBP: ['GB'],
  EUR: ['AT', 'BE', 'DE', 'ES', 'FI', 'FR', 'IE', 'IT', 'NL', 'PT'],
  USD: ['US'],
  INR: ['IN'],
  NGN: ['NG'],
  PHP: ['PH'],
  MXN: ['MX'],
};

/** The field whose last four characters identify the account in a summary. */
const SUMMARY_FIELD: Readonly<Record<string, [string, string]>> = {
  GBP: ['accountNumber', 'Acct'],
  EUR: ['iban', 'IBAN'],
  USD: ['accountNumber', 'Acct'],
  INR: ['accountNumber', 'Acct'],
  NGN: ['accountNumber', 'Acct'],
  PHP: ['accountNumber', 'Acct'],
  MXN: ['clabe', 'CLABE'],
};

function accountFields(currency: string): FormField[] {
  switch (currency) {
    case 'GBP':
      return [
        text('sortCode', 'Sort code', 'account', { pattern: '^\\d{6}$' }, { example: '231470' }),
        text('accountNumber', 'Account number', 'account', { pattern: '^\\d{8}$' }),
      ];
    case 'EUR':
      return [
        text(
          'iban',
          'IBAN',
          'account',
          { pattern: '^[A-Z]{2}\\d{2}[A-Z0-9]{11,30}$' },
          { example: 'DE89370400440532013000' },
        ),
        text(
          'bic',
          'BIC / SWIFT (optional)',
          'account',
          { pattern: '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$' },
          { required: false },
        ),
      ];
    case 'USD':
      return [
        text('routingNumber', 'ACH routing number', 'account', { pattern: '^\\d{9}$' }),
        text('accountNumber', 'Account number', 'account', { pattern: '^\\d{4,17}$' }),
        select('accountType', 'Account type', 'account', [
          ['CHECKING', 'Checking'],
          ['SAVINGS', 'Savings'],
        ]),
      ];
    case 'INR':
      return [
        text(
          'ifsc',
          'IFSC code',
          'account',
          { pattern: '^[A-Z]{4}0[A-Z0-9]{6}$' },
          { example: 'HDFC0001234' },
        ),
        text('accountNumber', 'Account number', 'account', { pattern: '^\\d{9,18}$' }),
      ];
    case 'MXN':
      return [text('clabe', 'CLABE', 'account', { pattern: '^\\d{18}$' })];
    case 'NGN':
      return [
        select('bankCode', 'Bank', 'account', [
          ['044', 'Access Bank'],
          ['058', 'Guaranty Trust Bank'],
          ['057', 'Zenith Bank'],
        ]),
        text('accountNumber', 'Account number (NUBAN)', 'account', { pattern: '^\\d{10}$' }),
      ];
    case 'PHP':
      return [
        select('bankCode', 'Bank', 'account', [
          ['BDO', 'BDO Unibank'],
          ['BPI', 'Bank of the Philippine Islands'],
          ['MBTC', 'Metrobank'],
        ]),
        text('accountNumber', 'Account number', 'account', { pattern: '^\\d{10,16}$' }),
      ];
    default:
      return [];
  }
}

/**
 * The recipient form for a currency. `legalType` is flagged `refreshOnChange`:
 * choosing BUSINESS adds a business-name field, as real providers do.
 */
export function recipientForm(currency: string, partialValues: FormValues = {}): DynamicForm {
  const isBusiness = partialValues.legalType === 'BUSINESS';
  return {
    groups: [
      { key: 'holder', label: 'Account holder' },
      { key: 'account', label: 'Bank account' },
    ],
    fields: [
      select(
        'legalType',
        'Recipient type',
        'holder',
        [
          ['PRIVATE', 'Person'],
          ['BUSINESS', 'Business'],
        ],
        { type: 'radio', refreshOnChange: true },
      ),
      text('accountHolderName', 'Full name of the account holder', 'holder', {
        minLength: 2,
        maxLength: 140,
      }),
      ...(isBusiness
        ? [
            text('businessName', 'Registered business name', 'holder', {
              minLength: 2,
              maxLength: 140,
            }),
          ]
        : []),
      ...accountFields(currency),
    ],
  };
}

export function transferForm(targetCurrency: string): DynamicForm {
  return {
    groups: [{ key: 'details', label: 'About this transfer' }],
    fields: [
      select('purpose', 'Purpose of the transfer', 'details', [
        ['family_support', 'Family support'],
        ['gift', 'Gift'],
        ['goods_services', 'Paying for goods or services'],
        ['education', 'Education'],
        ['other', 'Other'],
      ]),
      ...(targetCurrency === 'INR'
        ? [
            select('sourceOfFunds', 'Source of funds', 'details', [
              ['salary', 'Salary'],
              ['savings', 'Savings'],
              ['business', 'Business income'],
            ]),
          ]
        : []),
    ],
  };
}

/** Validates values against a form the way a provider would. */
export function validateForm(form: DynamicForm, values: FormValues): void {
  const errors: PayoutFieldError[] = [];
  const known = new Set(form.fields.map((field) => field.key));

  for (const key of Object.keys(values)) {
    if (!known.has(key)) {
      errors.push({ field: key, message: 'Unknown field' });
    }
  }
  for (const field of form.fields) {
    const value = values[field.key]?.trim() ?? '';
    if (value === '') {
      if (field.required) {
        errors.push({ field: field.key, message: `${field.label} is required` });
      }
      continue;
    }
    const { pattern, minLength, maxLength } = field.validation;
    if (
      (pattern !== undefined && !new RegExp(pattern).test(value)) ||
      (minLength !== undefined && value.length < minLength) ||
      (maxLength !== undefined && value.length > maxLength)
    ) {
      errors.push({ field: field.key, message: `${field.label} is not valid` });
    }
    if (field.options && !field.options.some((option) => option.value === value)) {
      errors.push({
        field: field.key,
        message: `${field.label} is not one of the allowed choices`,
      });
    }
  }
  if (errors.length > 0) {
    throw new ValidationFailedError(errors);
  }
}

export function accountSummary(currency: string, values: FormValues): string {
  const [key, label] = SUMMARY_FIELD[currency] ?? ['accountNumber', 'Acct'];
  const value = values[key] ?? '';
  return `${label} ${value.length >= 4 ? `••••${value.slice(-4)}` : '••••'}`;
}
