import { NeedsRelinkError } from '../../domain/payout/errors.ts';
import type { ProviderCustomerLink } from '../../domain/payout/models.ts';
import type { CustomerLinkStore } from '../transfer/ports.ts';
import type { PayoutProvider } from './payout-provider.ts';

function linkOf(args: unknown[]): ProviderCustomerLink | undefined {
  for (const arg of args) {
    if (typeof arg !== 'object' || arg === null) continue;
    const candidate = 'link' in arg ? arg.link : arg;
    if (
      typeof candidate === 'object' &&
      candidate !== null &&
      'provider' in candidate &&
      'customerRef' in candidate
    ) {
      return candidate as ProviderCustomerLink;
    }
  }
  return undefined;
}

/**
 * Wraps a provider so that whenever any call made for a customer fails with
 * {@link NeedsRelinkError} – the provider no longer accepts the customer's
 * connection or tokens – the customer's link is marked NEEDS_RELINK. Every
 * money endpoint then refuses them until they connect again. The original
 * error is always rethrown.
 */
export function withRelinkGuard(
  provider: PayoutProvider,
  customerLinkStore: Pick<CustomerLinkStore, 'markNeedsRelink'>,
): PayoutProvider {
  return new Proxy(provider, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') {
        return value;
      }
      return (...args: unknown[]): unknown => {
        const result: unknown = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (!(result instanceof Promise)) {
          return result;
        }
        return result.catch(async (error: unknown) => {
          const link = linkOf(args);
          if (error instanceof NeedsRelinkError && link) {
            await customerLinkStore.markNeedsRelink(link.provider, link.customerRef);
          }
          throw error;
        });
      };
    },
  });
}
