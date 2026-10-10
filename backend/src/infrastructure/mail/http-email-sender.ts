import { EmailDeliveryError } from '../../application/email/email-sender.ts';

/**
 * POSTs to an email provider's HTTP API. Never includes the request body or the
 * address in an error: they hold the customer's email and possibly a single-use link.
 */
export async function postJson(options: {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<void> {
  let response: Response;
  try {
    response = await options.fetchImpl(options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...options.headers,
      },
      body: options.body,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch {
    throw new EmailDeliveryError(`${options.provider}: could not reach the email service`, true);
  }
  if (response.ok) {
    return;
  }
  // 429 and 5xx may succeed later; other 4xx (bad key, bad address, unverified sender) will not.
  const retryable = response.status === 429 || response.status >= 500;
  throw new EmailDeliveryError(
    `${options.provider}: the email service answered ${response.status}`,
    retryable,
  );
}
