/**
 * Minimal structured JSON logger.
 *
 * Deliberately dependency-free: a fintech backend must guarantee that sensitive
 * values never reach the logs (core security rule 5), and a small auditable
 * implementation with built-in key redaction is easier to reason about than a
 * third-party logger's configuration. If log routing/transport needs grow this
 * can be swapped for `pino` behind the same interface. See
 * docs/architecture/adr/0004-backend-logging.md.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

/** Keys whose values must never be logged, matched case-insensitively. */
const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|authorization|auth|api[-_]?key|private[-_]?key|credential|card[-_]?number|cvv|cvc|pan|iban|sort[-_]?code|account[-_]?number|ssn|pin|cookie|routing|swift|bic|clabe|ifsc|totp|e[-_]?mail|phone|birth|dob|first[-_]?name|last[-_]?name|full[-_]?name|passport|address|postcode)/i;

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  base?: LogFields;
  /** Sink for a serialised log line. Defaults to stdout/stderr by level. */
  write?: (level: LogLevel, line: string) => void;
}

function redact(value: unknown, depth: number): unknown {
  if (depth >= MAX_DEPTH) {
    return '[TRUNCATED]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(nested, depth + 1);
    }
    return output;
  }

  return value;
}

function defaultWrite(level: LogLevel, line: string): void {
  const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = LEVEL_WEIGHT[options.level];
  const base = options.base ?? {};
  const write = options.write ?? defaultWrite;

  function log(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_WEIGHT[level] < threshold) {
      return;
    }

    const record = redact(
      { time: new Date().toISOString(), level, msg: message, ...base, ...fields },
      0,
    );

    write(level, JSON.stringify(record));
  }

  return {
    debug: (message, fields) => log('debug', message, fields),
    info: (message, fields) => log('info', message, fields),
    warn: (message, fields) => log('warn', message, fields),
    error: (message, fields) => log('error', message, fields),
    child: (bindings) =>
      createLogger({
        level: options.level,
        base: { ...base, ...bindings },
        ...(options.write ? { write: options.write } : {}),
      }),
  };
}
