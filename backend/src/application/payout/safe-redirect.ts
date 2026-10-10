import { ServiceUnavailableError } from '../../shared/errors.ts';

export interface RedirectPolicy {
  /** Hosts the provider's hosted pages may be on. Subdomains match. */
  readonly allowedHosts: readonly string[];
  /** This backend's own origin: the mock provider's dev pages live here. */
  readonly ownOrigin: string;
  readonly isProduction: boolean;
}

/** The provider sent the customer somewhere we do not trust. */
export class UnsafeRedirectError extends ServiceUnavailableError {
  constructor() {
    super("We couldn't start the identity check. Please try again later.");
  }
}

function isIpLiteral(host: string): boolean {
  return /^[\d.]+$/.test(host) || host.includes(':');
}

/**
 * Checks the page a provider asks us to send the customer to for their
 * identity check, BEFORE it is handed to the app. It must be HTTPS, carry no
 * credentials, name a host (not an IP address) and, when a list of provider
 * hosts is configured, be on one of them. The only exception is the mock
 * provider's own page on this backend, and only outside production.
 */
export function assertSafeProviderRedirect(url: string, policy: RedirectPolicy): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeRedirectError();
  }
  const ownDevPage =
    !policy.isProduction &&
    parsed.origin === policy.ownOrigin &&
    parsed.pathname === '/dev/mock/kyc';
  if (ownDevPage) {
    return parsed.toString();
  }
  const host = parsed.hostname.toLowerCase();
  const listed =
    policy.allowedHosts.length === 0 ||
    policy.allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    isIpLiteral(host) ||
    !listed
  ) {
    throw new UnsafeRedirectError();
  }
  return parsed.toString();
}
