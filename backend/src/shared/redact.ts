/**
 * Removes personal data from a provider payload before it is stored.
 *
 * Provider adapters already reduce payloads to what SomPay needs; this is the
 * second line of defence. It is a deny-list on key names (names, contact
 * details, addresses, bank and identity numbers, secrets) applied at any depth,
 * and it caps depth and size so a hostile payload cannot bloat a row.
 */

const REDACTED = '[redacted]';
const MAX_DEPTH = 8;
const MAX_KEYS = 60;
const MAX_ITEMS = 40;
const MAX_STRING = 200;

const PII_KEY =
  /(first.?name|last.?name|full.?name|given.?name|family.?name|holder|e.?mail|phone|mobile|address|street|postcode|post.?code|zip|city|suburb|birth|dob|nationalit|passport|document|identif|tax|ssn|iban|account.?(number|no|id)|sort.?code|routing|swift|bic|clabe|ifsc|card|cvv|token|secret|password|authorization|signature|beneficiar|recipient|sender|files?$)/i;

/** An event name such as `payout.transfer.sent` or `transfers#state-change`. */
function looksLikeEventName(value: unknown): boolean {
  return typeof value === 'string' && /^[a-z0-9_.#:-]{1,80}$/.test(value);
}

export function redactPayload(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (depth >= MAX_DEPTH) {
    return REDACTED;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((item) => redactPayload(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>).slice(
      0,
      MAX_KEYS,
    )) {
      // `name` is an event type for some providers and a person's name for others.
      const isPii = key === 'name' ? !looksLikeEventName(inner) : PII_KEY.test(key);
      out[key] = isPii ? REDACTED : redactPayload(inner, depth + 1);
    }
    return out;
  }
  return REDACTED;
}
