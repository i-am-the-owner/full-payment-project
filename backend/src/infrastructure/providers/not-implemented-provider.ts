import type { PayoutProvider } from '../../application/payout/payout-provider.ts';
import { NotImplementedError } from '../../domain/payout/errors.ts';
import type { ProviderName } from '../../domain/payout/models.ts';

/**
 * Placeholder for a provider whose adapter has not been built. Selecting it
 * validates its configuration at startup, but every operation throws
 * {@link NotImplementedError} and no webhook is ever accepted.
 */
export class NotImplementedPayoutProvider implements PayoutProvider {
  readonly name: ProviderName;

  constructor(name: ProviderName) {
    this.name = name;
  }

  #reject(operation: string): Promise<never> {
    return Promise.reject(new NotImplementedError(this.name, operation));
  }

  getCapabilities = (): Promise<never> => this.#reject('getCapabilities');
  startCustomerOnboarding = (): Promise<never> => this.#reject('startCustomerOnboarding');
  completeCustomerOnboarding = (): Promise<never> => this.#reject('completeCustomerOnboarding');
  getCustomerStatus = (): Promise<never> => this.#reject('getCustomerStatus');
  listCurrencies = (): Promise<never> => this.#reject('listCurrencies');
  createQuote = (): Promise<never> => this.#reject('createQuote');
  getRecipientForm = (): Promise<never> => this.#reject('getRecipientForm');
  createRecipient = (): Promise<never> => this.#reject('createRecipient');
  updateQuoteWithRecipient = (): Promise<never> => this.#reject('updateQuoteWithRecipient');
  getTransferForm = (): Promise<never> => this.#reject('getTransferForm');
  createTransfer = (): Promise<never> => this.#reject('createTransfer');
  findTransferByIdempotencyKey = (): Promise<never> => this.#reject('findTransferByIdempotencyKey');
  getFundingInstructions = (): Promise<never> => this.#reject('getFundingInstructions');
  fundTransfer = (): Promise<never> => this.#reject('fundTransfer');
  getTransfer = (): Promise<never> => this.#reject('getTransfer');
  cancelTransfer = (): Promise<never> => this.#reject('cancelTransfer');

  verifyWebhook(): boolean {
    return false;
  }
  parseWebhook(): never {
    throw new NotImplementedError(this.name, 'parseWebhook');
  }
}
