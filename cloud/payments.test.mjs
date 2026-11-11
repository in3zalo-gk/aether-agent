import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { reconcilePayment, paymentView, verifyWebhook } from './payments.js';

globalThis.crypto ??= webcrypto;
const now = 1_730_000_000_000;
const secret = 'webhook-test-secret';

async function webhook({ id = '123', bodyId = id, timestamp = Math.floor(now / 1000), signature = true } = {}) {
  const requestId = 'request-123';
  const template = `id:${id.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(template)));
  const hex = Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
  return new Request(`https://example.test/webhook?data.id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${signature ? hex : '0'.repeat(64)}` },
    body: JSON.stringify({ data: { id: bodyId } }),
  });
}

function account() {
  return { username: 'say', supporter: false, settings: { theme: 'midnight' }, donations: [{ id: '11111111-1111-4111-8111-111111111111', providerId: 'pay-1', amount: 2500, status: 'pending', key: 'private' }] };
}
function payment(overrides = {}) {
  return { id: 'pay-1', external_reference: 'aether:say:11111111-1111-4111-8111-111111111111', transaction_amount: 25, currency_id: 'BRL', payment_method_id: 'pix', live_mode: true, status: 'approved', ...overrides };
}

test('verifyWebhook accepts a fresh correctly signed hexadecimal signature', async () => {
  assert.equal(await verifyWebhook(await webhook(), secret, { now }), '123');
  assert.equal(await verifyWebhook(await webhook({ timestamp: now }), secret, { now }), '123');
});

test('verifyWebhook rejects invalid signatures, stale timestamps and mismatched ids', async () => {
  await assert.rejects(() => verifyWebhook(webhook({ signature: false }), secret, { now }));
  await assert.rejects(() => verifyWebhook(webhook({ timestamp: Math.floor(now / 1000) - 301 }), secret, { now }));
  await assert.rejects(() => verifyWebhook(webhook({ bodyId: 'different' }), secret, { now }));
});

test('reconcilePayment refuses incorrect reference, provider and imprecise amount', () => {
  for (const bad of [
    payment({ external_reference: 'aether:other:11111111-1111-4111-8111-111111111111' }),
    payment({ id: 'other-provider' }),
    payment({ transaction_amount: 25.001 }),
    payment({ transaction_amount: 24.99 }),
  ]) assert.equal(reconcilePayment(account(), bad), false);
});

test('repeated approval is safe and a refund revokes support', () => {
  const a = account();
  assert.equal(reconcilePayment(a, payment()), true);
  assert.equal(a.donations[0].status, 'approved');
  assert.equal(a.supporter, true);
  assert.equal(reconcilePayment(a, payment()), true);
  assert.equal(reconcilePayment(a, payment({ status: 'refunded' })), true);
  assert.equal(a.donations[0].status, 'refunded');
  assert.equal(a.supporter, false);
  assert.equal(a.settings.theme, 'dark');
});

test('paymentView cannot expose internal donation fields', () => {
  assert.deepEqual(paymentView(account().donations[0]), { id: '11111111-1111-4111-8111-111111111111', status: 'pending', qrCode: undefined, qrImage: undefined, expiresAt: undefined });
});
