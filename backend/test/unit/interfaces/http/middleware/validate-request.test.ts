import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { validateRequest } from '../../../../../src/interfaces/http/middleware/validate-request.ts';
import { ValidationError } from '../../../../../src/shared/errors.ts';
import { mockRequest, runMiddleware } from '../../../../support/http-mocks.ts';

test('attaches the parsed values on success', async () => {
  const req = mockRequest({ query: { page: '2' }, body: { name: 'Ada' } });
  const { error } = await runMiddleware(
    validateRequest({
      query: z.object({ page: z.coerce.number().int().positive() }),
      body: z.object({ name: z.string().min(1) }),
    }),
    req,
  );

  assert.equal(error, undefined);
  assert.deepEqual(req.validated, { query: { page: 2 }, body: { name: 'Ada' } });
});

test('collects field errors from every part into one ValidationError', async () => {
  const req = mockRequest({ query: { page: 'abc' }, body: { name: '' } });
  const { error } = await runMiddleware(
    validateRequest({
      query: z.object({ page: z.coerce.number().int() }),
      body: z.object({ name: z.string().min(1) }),
    }),
    req,
  );

  assert.ok(error instanceof ValidationError);
  const fields = error.fieldErrors?.map((f) => f.field) ?? [];
  assert.ok(fields.includes('query.page'));
  assert.ok(fields.includes('body.name'));
});

test('a strict schema rejects unknown fields', async () => {
  const req = mockRequest({ query: { unexpected: '1' } });
  const { error } = await runMiddleware(validateRequest({ query: z.strictObject({}) }), req);

  assert.ok(error instanceof ValidationError);
});

test('does not expose values, only field paths and messages', async () => {
  const req = mockRequest({ body: { secretField: 'p@ssw0rd' } });
  const { error } = await runMiddleware(validateRequest({ body: z.strictObject({}) }), req);

  assert.ok(error instanceof ValidationError);
  assert.doesNotMatch(JSON.stringify(error.fieldErrors), /p@ssw0rd/);
});
