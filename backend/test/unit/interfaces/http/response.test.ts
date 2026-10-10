import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sendData,
  errorEnvelope,
  type SuccessEnvelope,
} from '../../../../src/interfaces/http/response.ts';
import { mockRequest, mockResponse } from '../../../support/http-mocks.ts';

test('sendData wraps the payload in a success envelope with meta', () => {
  const req = mockRequest({ id: 'req-123' });
  const response = mockResponse(req);

  sendData(response.res, { hello: 'world' }, 201);

  assert.equal(response.statusCode, 201);
  const body = response.body as SuccessEnvelope<{ hello: string }>;
  assert.deepEqual(body.data, { hello: 'world' });
  assert.equal(body.meta.requestId, 'req-123');
  assert.match(body.meta.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('errorEnvelope carries the code, message, request id and optional field errors', () => {
  const req = mockRequest({ id: 'req-err' });
  const response = mockResponse(req);

  const withoutFields = errorEnvelope(response.res, 'NOT_FOUND', 'missing');
  assert.equal(withoutFields.error.code, 'NOT_FOUND');
  assert.equal(withoutFields.error.requestId, 'req-err');
  assert.equal(withoutFields.error.fieldErrors, undefined);

  const withFields = errorEnvelope(response.res, 'VALIDATION_ERROR', 'bad', [
    { field: 'body.name', message: 'Required' },
  ]);
  assert.deepEqual(withFields.error.fieldErrors, [{ field: 'body.name', message: 'Required' }]);
});
