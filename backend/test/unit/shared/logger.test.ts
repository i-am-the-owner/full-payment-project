import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, type Logger, type LogLevel } from '../../../src/shared/logger.ts';

interface Captured {
  level: LogLevel;
  record: Record<string, unknown>;
}

function capturingLogger(level: LogLevel): { logger: Logger; lines: Captured[] } {
  const lines: Captured[] = [];
  const logger = createLogger({
    level,
    write: (lvl, line) =>
      lines.push({ level: lvl, record: JSON.parse(line) as Record<string, unknown> }),
  });
  return { logger, lines };
}

test('logger emits structured JSON with time, level and msg', () => {
  const { logger, lines } = capturingLogger('info');
  logger.info('thing.happened', { count: 2 });

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.record.level, 'info');
  assert.equal(lines[0]?.record.msg, 'thing.happened');
  assert.equal(lines[0]?.record.count, 2);
  assert.equal(typeof lines[0]?.record.time, 'string');
});

test('logger suppresses messages below the configured level', () => {
  const { logger, lines } = capturingLogger('warn');
  logger.info('ignored');
  logger.debug('ignored');
  logger.warn('kept');

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.record.msg, 'kept');
});

test('logger redacts sensitive keys at any depth', () => {
  const { logger, lines } = capturingLogger('info');
  logger.info('auth.attempt', {
    email: 'user@example.test',
    password: 'hunter2',
    nested: { accessToken: 'abc', cardNumber: '4111111111111111' },
  });

  const record = lines[0]?.record as Record<string, unknown>;
  // Personal data is redacted too, not just credentials.
  assert.equal(record.email, '[REDACTED]');
  assert.equal(record.password, '[REDACTED]');
  const nested = record.nested as Record<string, unknown>;
  assert.equal(nested.accessToken, '[REDACTED]');
  assert.equal(nested.cardNumber, '[REDACTED]');
});

test('logger redacts personal and bank data wherever it appears in a record', () => {
  const { logger, lines } = capturingLogger('info');
  logger.info('x', {
    phone: '+447700900123',
    dateOfBirth: '1990-04-12',
    firstName: 'Jane',
    lastName: 'Doe',
    address: { postcode: 'SW1A 1AA' },
    routingNumber: '021000021',
    swiftBic: 'DEUTDEFF',
    clabe: '032180000118359719',
    ifsc: 'HDFC0001234',
    cookie: 'sid=abc',
    totpCode: '123456',
    safe: { transferId: 'abc', status: 'SENT' },
  });
  const text = JSON.stringify(lines[0]?.record);
  for (const secret of [
    '+447700900123',
    '1990-04-12',
    'Jane',
    'SW1A',
    '021000021',
    'DEUTDEFF',
    '0321800',
    'HDFC0',
    'sid=abc',
    '123456',
  ]) {
    assert.ok(!text.includes(secret), `${secret} must not be logged`);
  }
  assert.ok(text.includes('"transferId":"abc"') && text.includes('"status":"SENT"'));
});

test('child logger merges bindings into every record', () => {
  const { logger, lines } = capturingLogger('info');
  logger.child({ requestId: 'req-1' }).info('scoped');

  assert.equal(lines[0]?.record.requestId, 'req-1');
});
