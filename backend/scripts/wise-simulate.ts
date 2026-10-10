/**
 * DEV TOOL (Wise sandbox only). Moves a FUNDED sandbox transfer to another
 * state with Wise's Simulation API, so Wise sends its real webhook to the
 * subscribed URL: the whole path (signature, queue, worker) is then the real one.
 *
 *   PAYOUT_PROVIDER=wise WISE_... (sandbox credentials) \
 *     node --env-file-if-exists=.env scripts/wise-simulate.ts \
 *       --profile-id <the customer's Wise profile id> --transfer <wise transfer id> --state processing
 *
 * Wise states: processing, funds_converted, outgoing_payment_sent, bounced_back,
 * funds_refunded. Wise's rules: the transfer must be funded, and calls for one
 * transfer must be at least 5 seconds apart. Refused against a production host.
 */
import { parseArgs } from 'node:util';
import { createContainer } from '../src/container.ts';
import type { WisePayoutProvider } from '../src/infrastructure/providers/wise/wise-payout-provider.ts';

const STATES = [
  'processing',
  'funds_converted',
  'outgoing_payment_sent',
  'bounced_back',
  'funds_refunded',
] as const;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'profile-id': { type: 'string' },
      transfer: { type: 'string' },
      state: { type: 'string' },
    },
  });
  if (!values['profile-id'] || !values.transfer || !values.state) {
    throw new Error('Usage: --profile-id <id> --transfer <wise transfer id> --state <state>');
  }
  if (!(STATES as readonly string[]).includes(values.state)) {
    throw new Error(`--state must be one of: ${STATES.join(', ')}`);
  }
  const container = createContainer({ ...process.env, PAYOUT_PROVIDER: 'wise' });
  try {
    const provider = container.payoutProvider;
    // The relink guard wraps the provider; unwrap by asking for the sandbox method.
    const simulate = (provider as unknown as Partial<WisePayoutProvider>).simulateTransferState;
    if (typeof simulate !== 'function') {
      throw new Error('The active provider is not Wise.');
    }
    const result = await simulate.call(
      provider,
      { provider: 'wise', customerRef: values['profile-id'] },
      values.transfer,
      values.state,
    );
    console.log(`Wise transfer ${values.transfer} is now "${String(result.status)}".`);
    console.log('Wise will now send its webhook to your subscribed URL.');
  } finally {
    await container.shutdown();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
