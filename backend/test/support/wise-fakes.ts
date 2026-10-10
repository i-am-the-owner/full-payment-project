import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createLogger, type Logger } from '../../src/shared/logger.ts';
import type { AuditLog, AuditLogEntry } from '../../src/application/audit/audit-log.ts';
import type { WiseTransport } from '../../src/infrastructure/providers/wise/wise-http-client.ts';

export const silentWiseLogger: Logger = createLogger({ level: 'error', write: () => {} });

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/wise');

/** Loads a Wise API fixture (a copy of a documented Wise response shape). */
export function wiseFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as T;
}

export class RecordingAuditLog implements AuditLog {
  readonly entries: AuditLogEntry[] = [];
  record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
  actions(): string[] {
    return this.entries.map((e) => e.action);
  }
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface FakeResponseSpec {
  status: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

function toResponse(spec: FakeResponseSpec): Awaited<ReturnType<WiseTransport>> {
  const headers = spec.headers ?? {};
  return {
    status: spec.status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: () =>
      Promise.resolve(spec.text ?? (spec.body === undefined ? '' : JSON.stringify(spec.body))),
  };
}

/** A `WiseTransport` driven by a handler, recording every request. */
export function handlerTransport(
  handler: (req: RecordedRequest) => FakeResponseSpec | Promise<FakeResponseSpec>,
): { transport: WiseTransport; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const transport: WiseTransport = async (url, init) => {
    if (init.signal.aborted) {
      throw abortError();
    }
    const recorded: RecordedRequest = {
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    };
    requests.push(recorded);
    return toResponse(await handler(recorded));
  };
  return { transport, requests };
}

/** A `WiseTransport` that returns queued responses in order (for retry tests). */
export function queueTransport(specs: (FakeResponseSpec | 'network-error' | 'hang')[]): {
  transport: WiseTransport;
  requests: RecordedRequest[];
} {
  let index = 0;
  return handlerTransport((): FakeResponseSpec | Promise<FakeResponseSpec> => {
    const spec = specs[Math.min(index, specs.length - 1)];
    index += 1;
    if (spec === 'network-error') {
      throw new Error('ECONNRESET');
    }
    if (spec === 'hang') {
      return new Promise<FakeResponseSpec>(() => {
        /* never resolves – rely on the abort signal */
      });
    }
    return spec as FakeResponseSpec;
  });
}

/** A transport that hangs until the request's timeout aborts it. */
export const hangingTransport: WiseTransport = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(abortError()));
  });

export function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}
