import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsername, validUsername, validUuid, validateProviderUrl } from './worker.js';

test('normalizes and restricts public handles', () => {
  assert.equal(normalizeUsername('  Say_Noob  '), 'say_noob');
  assert.equal(validUsername('say_noob'), true);
  assert.equal(validUsername('a@b.com'), false);
  assert.equal(validUsername('ab'), false);
});

test('accepts only UUIDv4 idempotency keys', () => {
  assert.equal(validUuid('123e4567-e89b-42d3-a456-426614174000'), true);
  assert.equal(validUuid('123e4567-e89b-12d3-a456-426614174000'), false);
});

test('provider URL blocks localhost, private literals and non HTTPS', async () => {
  for (const value of ['http://api.example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://api.internal']) {
    await assert.rejects(validateProviderUrl(value, async () => new Response('{}')));
  }
});

test('provider URL accepts a public HTTPS hostname after public DNS', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }));
  assert.equal(await validateProviderUrl('https://api.example.com/', fakeFetch), 'https://api.example.com');
});

test('provider URL rejects DNS answers containing private records', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }, { type: 1, data: '10.0.0.1' }] }));
  await assert.rejects(validateProviderUrl('https://api.example.com', fakeFetch));
});
