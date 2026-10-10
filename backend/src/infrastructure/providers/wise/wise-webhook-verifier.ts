import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';
import type { WiseTransferStateChangeEvent, WiseTransferStatus } from './wise-models.ts';

const KNOWN_STATUSES: readonly WiseTransferStatus[] = [
  'incoming_payment_waiting',
  'incoming_payment_initiated',
  'processing',
  'funds_converted',
  'outgoing_payment_sent',
  'charged_back',
  'cancelled',
  'funds_refunded',
  'bounced_back',
];

function toStatus(value: unknown): WiseTransferStatus {
  return typeof value === 'string' && (KNOWN_STATUSES as readonly string[]).includes(value)
    ? (value as WiseTransferStatus)
    : 'unknown';
}

interface StateChangeBody {
  data?: {
    resource?: { id?: unknown; type?: unknown };
    current_state?: unknown;
    previous_state?: unknown;
    occurred_at?: unknown;
  };
  subscription_id?: unknown;
  event_type?: unknown;
  schema_version?: unknown;
}

/**
 * RSA-SHA256 verification of the raw request body against the
 * `X-Signature-SHA256` header, using Wise's published public key.
 */
export class RsaWiseWebhookVerifier {
  readonly #publicKey: KeyObject;

  constructor(publicKeyPem: string) {
    this.#publicKey = createPublicKey(publicKeyPem);
  }

  isValidSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) {
      return false;
    }
    let signature: Buffer;
    try {
      signature = Buffer.from(signatureHeader, 'base64');
    } catch {
      return false;
    }
    if (signature.length === 0) {
      return false;
    }
    try {
      return createVerify('RSA-SHA256').update(rawBody).verify(this.#publicKey, signature);
    } catch {
      return false;
    }
  }

  parseTransferStateChange(
    rawBody: Buffer,
    headers: { deliveryId?: string | undefined; isTest?: boolean },
  ): WiseTransferStateChangeEvent {
    const parsed = JSON.parse(rawBody.toString('utf8')) as StateChangeBody;

    if (parsed.event_type !== 'transfers#state-change') {
      throw new Error(`Unsupported Wise webhook event: ${String(parsed.event_type)}`);
    }
    const rawResourceId = parsed.data?.resource?.id;
    const occurredAt = parsed.data?.occurred_at;
    const resourceId =
      typeof rawResourceId === 'string' || typeof rawResourceId === 'number'
        ? String(rawResourceId)
        : undefined;
    if (resourceId === undefined || typeof occurredAt !== 'string') {
      throw new Error('Malformed transfers#state-change payload');
    }

    return {
      eventType: 'transfers#state-change',
      schemaVersion: typeof parsed.schema_version === 'string' ? parsed.schema_version : 'unknown',
      subscriptionId:
        typeof parsed.subscription_id === 'string' ? parsed.subscription_id : 'unknown',
      deliveryId: headers.deliveryId,
      isTest: headers.isTest ?? false,
      transferId: resourceId,
      currentStatus: toStatus(parsed.data?.current_state),
      previousStatus:
        parsed.data?.previous_state === undefined || parsed.data.previous_state === null
          ? undefined
          : toStatus(parsed.data.previous_state),
      occurredAt: new Date(occurredAt),
    };
  }

  /**
   * `kyc-reviews#state-change` (schema 5.0.0): the state of a customer's KYC
   * review. Documented states are WAITING_CUSTOMER_INPUT and PASSED; any other
   * state is returned as given and left unmapped by the adapter. Ordered by
   * `data.resource.updatedAt`.
   */
  parseKycStateChange(rawBody: Buffer): WiseKycStateChangeEvent {
    const parsed = JSON.parse(rawBody.toString('utf8')) as {
      event_type?: unknown;
      data?: {
        resource?: { id?: unknown; state?: unknown; profileId?: unknown; updatedAt?: unknown };
      };
    };
    if (parsed.event_type !== 'kyc-reviews#state-change') {
      throw new Error(`Unsupported Wise webhook event: ${String(parsed.event_type)}`);
    }
    const resource = parsed.data?.resource;
    const profileId = resource?.profileId;
    if (
      (typeof profileId !== 'string' && typeof profileId !== 'number') ||
      typeof resource?.state !== 'string' ||
      typeof resource.updatedAt !== 'string'
    ) {
      throw new Error('Malformed kyc-reviews#state-change payload');
    }
    return {
      reviewId: typeof resource.id === 'string' ? resource.id : undefined,
      profileId: String(profileId),
      state: resource.state,
      occurredAt: new Date(resource.updatedAt),
    };
  }
}

export interface WiseKycStateChangeEvent {
  readonly reviewId: string | undefined;
  readonly profileId: string;
  readonly state: string;
  readonly occurredAt: Date;
}
