/**
 * ISO 4217 minor-unit exponents. This is the published standard, not a list of
 * supported currencies: which currencies can be used always comes from the
 * provider at runtime. Only the exceptions are listed; every other ISO 4217
 * currency has two minor digits.
 */
const ZERO_DECIMALS = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'UYI',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);
const THREE_DECIMALS = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);
const FOUR_DECIMALS = new Set(['CLF', 'UYW']);

export function iso4217MinorUnits(currency: string): number {
  const code = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(`Not an ISO 4217 currency code: "${currency}"`);
  }
  if (ZERO_DECIMALS.has(code)) return 0;
  if (THREE_DECIMALS.has(code)) return 3;
  if (FOUR_DECIMALS.has(code)) return 4;
  return 2;
}

const displayNames = new Intl.DisplayNames(['en'], { type: 'currency' });

/** English display name for a currency code; the code itself if unknown. */
export function currencyDisplayName(currency: string): string {
  try {
    return displayNames.of(currency.toUpperCase()) ?? currency;
  } catch {
    return currency;
  }
}
