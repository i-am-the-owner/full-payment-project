/**
 * Exact conversion between decimal money strings and integer minor units.
 *
 * External systems (Wise) return amounts as JSON numbers/decimal strings such as
 * `129.24`. SomPay stores and compares money as `bigint` minor units. This
 * conversion is done with string arithmetic only – never `parseFloat` – so no
 * precision is lost.
 */

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * Parses a decimal amount into integer minor units for the given exponent.
 *
 * @example parseDecimalToMinorUnits('129.24', 2) === 12924n
 * @throws {RangeError} if the value is not a plain decimal or has more
 *   fractional digits than `minorUnitExponent` allows.
 */
export function parseDecimalToMinorUnits(
  value: string | number,
  minorUnitExponent: number,
): bigint {
  const text = typeof value === 'number' ? numberToDecimalString(value) : value.trim();

  if (!DECIMAL_PATTERN.test(text)) {
    throw new RangeError(`Not a decimal amount: "${text}"`);
  }
  if (minorUnitExponent < 0 || minorUnitExponent > 8 || !Number.isInteger(minorUnitExponent)) {
    throw new RangeError(`Invalid minor unit exponent: ${minorUnitExponent}`);
  }

  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');

  if (fraction.length > minorUnitExponent) {
    throw new RangeError(
      `Amount "${text}" has more precision than ${minorUnitExponent} minor digits allow`,
    );
  }

  const paddedFraction = fraction.padEnd(minorUnitExponent, '0');
  const magnitude = BigInt(`${whole}${paddedFraction}`);
  return negative ? -magnitude : magnitude;
}

/** Formats integer minor units back to a decimal string. */
export function formatMinorUnits(minor: bigint, minorUnitExponent: number): string {
  if (minorUnitExponent === 0) {
    return minor.toString();
  }
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(minorUnitExponent + 1, '0');
  const whole = digits.slice(0, -minorUnitExponent);
  const fraction = digits.slice(-minorUnitExponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Not a finite number: ${value}`);
  }
  // Avoid scientific notation for the magnitudes money uses.
  return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 12 });
}
