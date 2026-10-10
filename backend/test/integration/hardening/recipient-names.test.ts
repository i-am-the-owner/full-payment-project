import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DATABASE_URL, startTestContext, type TestContext } from '../support/harness.ts';

const suite = DATABASE_URL ? test : test.skip;
let ctx: TestContext;
before(async () => {
  if (DATABASE_URL) ctx = await startTestContext();
});
after(async () => {
  if (ctx) await ctx.close();
});

const EUR = {
  legalType: 'PRIVATE',
  accountHolderName: 'José Müller-Smith',
  iban: 'DE89370400440532013000',
};

async function add(token: string, values: Record<string, string>, displayName?: string) {
  return ctx.http('/api/v1/recipients', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      currency: 'EUR',
      country: 'DE',
      values,
      ...(displayName ? { displayName } : {}),
    }),
  });
}

suite('recipient names cannot carry markup (A-33)', async () => {
  const user = await ctx.createUser();
  const token = await ctx.issueToken(user.id);

  const okRes = await add(token, EUR, "O'Brien & Sons (Ltd.)");
  assert.equal(okRes.status, 201, JSON.stringify(okRes.body));

  for (const bad of ['<script>alert(1)</script>', 'Anna <b>S</b>', 'Anna\u0000Schmidt', 'a>b']) {
    const asName = await add(token, { ...EUR, accountHolderName: bad });
    assert.equal(asName.status, 400, `holder ${JSON.stringify(bad)}`);
    const asNickname = await add(token, EUR, bad);
    assert.equal(asNickname.status, 400, `nickname ${JSON.stringify(bad)}`);
  }
  assert.equal(await ctx.countRows('recipients', `user_id = '${user.id}'`), 1);
});
