/**
 * DEV TOOL (mock provider only). Sends signed test webhooks to a running
 * AlmaPay backend, exactly as a provider would, so every status can be tried
 * end to end: signature check, queue, worker, timeline, notification.
 *
 *   # The server and this script must share the secret:
 *   MOCK_WEBHOOK_SECRET=dev-only-secret-0123456789 npm run dev
 *   MOCK_WEBHOOK_SECRET=dev-only-secret-0123456789 \
 *     node scripts/send-mock-webhook.ts --transfer mock-transfer-<id> --status funded
 *
 *   --transfer <provider transfer id>   from the transfer's row (provider_transfer_id)
 *   --status <mock status>              pending_funding|funded|paid_out|delivered|cancelled|returned|rejected
 *   --all                               walk pending_funding -> funded -> paid_out -> delivered
 *   --customer <ref> --customer-status verified|pending|rejected|needs_relink
 *   --seconds-ago <n>                   date the event in the past (an out-of-order delivery)
 *   --times <n>                         send the same event n times (duplicate deliveries)
 *   --bad-signature                     sign with the wrong secret (expects 401)
 *   --url <base url>                    default http://localhost:3999
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  MOCK_SIGNATURE_HEADER,
  signMockWebhookBody,
} from '../src/infrastructure/providers/mock/mock-payout-provider.ts';
import {
  isMockTransferStatus,
  MOCK_TRANSFER_STATUSES,
} from '../src/infrastructure/providers/mock/mock-status-mapping.ts';

const HAPPY_PATH = ['pending_funding', 'funded', 'paid_out', 'delivered'] as const;
const CUSTOMER_STATUSES = ['verified', 'pending', 'rejected', 'needs_relink'] as const;

export interface MockWebhookRequest {
  readonly body: string;
  readonly headers: Record<string, string>;
}

/** Builds the signed request for one mock transfer event. */
export function transferWebhook(
  secret: string,
  input: { providerTransferId: string; status: string; occurredAt: Date; eventId?: string },
): MockWebhookRequest {
  const body = JSON.stringify({
    event: 'transfer.updated',
    event_id: input.eventId ?? randomUUID(),
    transfer_id: input.providerTransferId,
    status: input.status,
    occurred_at: input.occurredAt.toISOString(),
  });
  return sign(secret, body);
}

export function customerWebhook(
  secret: string,
  input: { customerRef: string; status: string; occurredAt: Date; eventId?: string },
): MockWebhookRequest {
  const body = JSON.stringify({
    event: 'customer.updated',
    event_id: input.eventId ?? randomUUID(),
    customer_ref: input.customerRef,
    status: input.status,
    occurred_at: input.occurredAt.toISOString(),
  });
  return sign(secret, body);
}

function sign(secret: string, body: string): MockWebhookRequest {
  return {
    body,
    headers: {
      'content-type': 'application/json',
      [MOCK_SIGNATURE_HEADER]: signMockWebhookBody(secret, Buffer.from(body)),
    },
  };
}

async function send(base: string, request: MockWebhookRequest): Promise<string> {
  const response = await fetch(`${base}/webhooks/mock`, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
  });
  return `${response.status} ${await response.text()}`;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('This dev tool refuses to run with NODE_ENV=production.');
  }
  const { values } = parseArgs({
    options: {
      transfer: { type: 'string' },
      status: { type: 'string' },
      all: { type: 'boolean', default: false },
      customer: { type: 'string' },
      'customer-status': { type: 'string' },
      'seconds-ago': { type: 'string', default: '0' },
      times: { type: 'string', default: '1' },
      'bad-signature': { type: 'boolean', default: false },
      url: { type: 'string', default: 'http://localhost:3999' },
    },
  });
  const secret = values['bad-signature']
    ? 'not-the-servers-secret'
    : process.env.MOCK_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('Set MOCK_WEBHOOK_SECRET to the same value the server was started with.');
  }
  const base = (values.url ?? '').replace(/\/+$/, '');
  const occurredAt = new Date(Date.now() - Number(values['seconds-ago']) * 1000);
  const times = Math.max(1, Number(values.times));

  if (values.customer) {
    const status = values['customer-status'];
    if (!status || !(CUSTOMER_STATUSES as readonly string[]).includes(status)) {
      throw new Error(`--customer-status must be one of: ${CUSTOMER_STATUSES.join(', ')}`);
    }
    const request = customerWebhook(secret, { customerRef: values.customer, status, occurredAt });
    for (let i = 0; i < times; i += 1) {
      console.log(`customer ${values.customer} -> ${status}: ${await send(base, request)}`);
    }
    return;
  }

  if (!values.transfer) {
    throw new Error('Give --transfer <provider transfer id> (or --customer <ref>).');
  }
  const statuses = values.all ? [...HAPPY_PATH] : values.status ? [values.status] : [];
  if (statuses.length === 0 || !statuses.every(isMockTransferStatus)) {
    throw new Error(`--status must be one of: ${MOCK_TRANSFER_STATUSES.join(', ')} (or use --all)`);
  }
  for (const status of statuses) {
    const request = transferWebhook(secret, {
      providerTransferId: values.transfer,
      status,
      occurredAt: values.all ? new Date() : occurredAt,
    });
    for (let i = 0; i < times; i += 1) {
      console.log(`${values.transfer} -> ${status}: ${await send(base, request)}`);
    }
    if (values.all) {
      // Let the worker apply each step before the next arrives.
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
