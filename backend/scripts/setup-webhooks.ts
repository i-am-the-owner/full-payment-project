/**
 * Registers AlmaPay's webhook URL with the payout provider.
 *
 *   WEBHOOK_BASE_URL=https://api.almapay.example PAYOUT_PROVIDER=wise \
 *   WISE_CLIENT_KEY=... WISE_CLIENT_ID=... WISE_CLIENT_SECRET=... \
 *     node --env-file-if-exists=.env scripts/setup-webhooks.ts [--dry-run]
 *
 * The URL given to the provider is  <WEBHOOK_BASE_URL>/webhooks/<provider>.
 *
 *   mock          nothing to register; prints the URL and how to send test webhooks.
 *   wise          creates one application-level subscription per event we handle
 *                 (transfers#state-change, kyc-reviews#state-change) through
 *                 POST /applications/{clientKey}/subscriptions. Wise creates a NEW
 *                 subscription on every call and sends duplicates for duplicates
 *                 (AlmaPay ignores them), so run it once and check Developer Hub first.
 *   airwallex     webhooks are created in the Airwallex web app, so this prints the
 *                 steps and the events to select.
 *   currencycloud not implemented yet.
 *
 * Secrets are read from the environment only and are never printed.
 */
import { parseArgs } from 'node:util';

export const WISE_SUBSCRIPTIONS = [
  // 4.0.0+ has millisecond timestamps, which AlmaPay uses to order events.
  { name: 'AlmaPay transfer status', trigger_on: 'transfers#state-change', version: '4.0.0' },
  { name: 'AlmaPay KYC status', trigger_on: 'kyc-reviews#state-change', version: '5.0.0' },
] as const;

export const AIRWALLEX_EVENTS = [
  'payout.transfer.* (every transfer status event)',
  'account.active, account.submitted, account.action_required, account.suspended, account.dormant, account.closed',
] as const;

/**
 * The URL we hand to a provider. Both Wise and Airwallex need HTTPS; Wise also
 * refuses a port, query string, credentials or an IP address.
 */
export function webhookUrl(baseUrl: string | undefined, provider: string): string {
  if (!baseUrl) {
    throw new Error("Set WEBHOOK_BASE_URL to this API's public https address.");
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('WEBHOOK_BASE_URL is not a valid URL.');
  }
  if (url.protocol !== 'https:') throw new Error('WEBHOOK_BASE_URL must start with https://');
  if (url.port) throw new Error('WEBHOOK_BASE_URL must not include a port number.');
  if (url.search || url.hash) throw new Error('WEBHOOK_BASE_URL must not include a query string.');
  if (url.username || url.password)
    throw new Error('WEBHOOK_BASE_URL must not include credentials.');
  if (/^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) {
    throw new Error('WEBHOOK_BASE_URL must use a domain name, not an IP address.');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}/webhooks/${provider}`;
}

interface SubscriptionRequest {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

export function wiseSubscriptionRequests(clientKey: string, url: string): SubscriptionRequest[] {
  return WISE_SUBSCRIPTIONS.map((s) => ({
    path: `/2026Q4/applications/${encodeURIComponent(clientKey)}/subscriptions`,
    body: {
      name: s.name,
      trigger_on: s.trigger_on,
      delivery: { version: s.version, url },
    },
  }));
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
  const provider = process.env.PAYOUT_PROVIDER ?? 'mock';
  const url = webhookUrl(process.env.WEBHOOK_BASE_URL, provider);
  console.log(`Webhook URL for ${provider}: ${url}`);

  switch (provider) {
    case 'mock':
      console.log('The mock provider needs no registration.');
      console.log('Send it test webhooks with: node scripts/send-mock-webhook.ts --help');
      return;
    case 'airwallex':
      console.log('Airwallex webhooks are created in the Airwallex web app:');
      console.log('  1. Developer > Webhooks > New webhook');
      console.log(`  2. Notification URL: ${url}`);
      console.log('  3. Select these events:');
      for (const event of AIRWALLEX_EVENTS) console.log(`       - ${event}`);
      console.log('  4. Copy the webhook secret into AIRWALLEX_WEBHOOK_SECRET (never into code).');
      return;
    case 'wise': {
      const clientKey = process.env.WISE_CLIENT_KEY;
      if (!clientKey) throw new Error('Set WISE_CLIENT_KEY (from the Wise Developer Hub).');
      const requests = wiseSubscriptionRequests(clientKey, url);
      if (values['dry-run']) {
        for (const request of requests) {
          console.log(`POST ${request.path}  ${JSON.stringify(request.body)}`);
        }
        return;
      }
      const clientId = process.env.WISE_CLIENT_ID;
      const clientSecret = process.env.WISE_CLIENT_SECRET;
      const base = (process.env.WISE_API_BASE_URL ?? '').replace(/\/+$/, '');
      if (!clientId || !clientSecret || !base) {
        throw new Error('Set WISE_CLIENT_ID, WISE_CLIENT_SECRET and WISE_API_BASE_URL.');
      }
      const tokenResponse = await fetch(`${base}/oauth/token`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      const token = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string };
      if (!tokenResponse.ok || !token.access_token) {
        throw new Error(`Could not get a Wise access token (HTTP ${tokenResponse.status}).`);
      }
      for (const request of requests) {
        const response = await fetch(`${base}${request.path}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token.access_token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(request.body),
        });
        console.log(`${String(request.body.trigger_on)}: HTTP ${response.status}`);
        if (!response.ok) process.exitCode = 1;
      }
      return;
    }
    default:
      throw new Error(`Webhook setup for "${provider}" is not implemented yet.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
