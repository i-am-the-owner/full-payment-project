import { createSign, createPrivateKey, type KeyObject } from 'node:crypto';

/**
 * Signs Wise Strong Customer Authentication one-time-tokens.
 *
 * When an SCA-protected call (e.g. funding a transfer) returns HTTP 403 with an
 * `x-2fa-approval` one-time token, the request is retried with:
 *   - `x-2fa-approval: <one-time token>`
 *   - `X-Signature: base64( RSA-SHA256( <one-time token> ) )`
 * using SomPay's private key, whose public half was registered with Wise during
 * onboarding.
 */
export class WiseScaSigner {
  readonly #privateKey: KeyObject;

  constructor(privateKeyPem: string) {
    this.#privateKey = createPrivateKey(privateKeyPem);
  }

  /** Returns the base64 `X-Signature` value for a one-time token. */
  sign(oneTimeToken: string): string {
    return createSign('RSA-SHA256').update(oneTimeToken).sign(this.#privateKey, 'base64');
  }
}
