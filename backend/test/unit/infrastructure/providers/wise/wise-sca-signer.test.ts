import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { WiseScaSigner } from '../../../../../src/infrastructure/providers/wise/wise-sca-signer.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

test('produces a base64 RSA-SHA256 signature that Wise could verify', () => {
  const signer = new WiseScaSigner(privateKey);
  const oneTimeToken = 'ott-abc-123';

  const signature = signer.sign(oneTimeToken);

  assert.match(signature, /^[A-Za-z0-9+/]+={0,2}$/);
  const ok = createVerify('RSA-SHA256')
    .update(oneTimeToken)
    .verify(publicKey, Buffer.from(signature, 'base64'));
  assert.equal(ok, true);
});

test('a signature for one token does not verify for another', () => {
  const signer = new WiseScaSigner(privateKey);
  const signature = signer.sign('token-a');
  const ok = createVerify('RSA-SHA256')
    .update('token-b')
    .verify(publicKey, Buffer.from(signature, 'base64'));
  assert.equal(ok, false);
});
