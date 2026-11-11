import test from 'node:test';
import assert from 'node:assert/strict';
import { chatRoute, publicChat } from './chat.js';

const provider = { id: 'p1', baseUrl: 'https://api.example', key: 'sealed-key', format: 'openai', model: 'test-model' };
const clone = value => structuredClone(value);

function account() {
  return {
    providers: [clone(provider)],
    settings: { memoryEnabled: true },
    memories: [{ content: 'prefers concise replies' }],
    chats: [{ id: 'c1', title: 'Nova conversa', options: { browserEnabled: true, deviceEnabled: true }, messages: [] }]
  };
}

function request(path, body) {
  return new Request(`https://worker.example${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

function harness(initial = account()) {
  let stored = clone(initial);
  let revision = 0;
  const writes = [];
  const calls = [];
  const model = async input => {
    calls.push(clone(input));
    if (calls.length === 1) return {
      message: { role: 'assistant', content: 'Vou abrir.', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'browserOpen', arguments: '{"url":"https://example.com"}' } }] },
      toolCalls: [{ id: 'call-1', action: 'browserOpen', args: { url: 'https://example.com' } }]
    };
    return { message: { role: 'assistant', content: 'Página aberta.' }, toolCalls: [] };
  };
  return {
    calls, writes,
    deps: {
      env: { KEY_ENCRYPTION_SECRET: 'secret' }, name: 'say',
      get account() { return clone(stored); },
      putAccount: async (_env, _name, next) => { stored = clone(next); writes.push({ revision: ++revision, account: clone(next) }); },
      getAccount: async () => clone(stored),
      unseal: async key => { assert.equal(key, 'sealed-key'); return 'plain-key'; },
      validateProviderUrl: async () => {},
      research: async () => [], model
    }
  };
}

async function body(response) { return response.json(); }

test('chat stores a pending tool call, then consumes its result exactly once with history', async () => {
  const h = harness();
  const first = await chatRoute({ req: request('/api/chat', { chatId: 'c1', providerId: 'p1', message: 'Abra o site', nativeAvailable: true }), account: h.deps.account, ...h.deps });
  const firstBody = await body(first);
  assert.equal(first.status, 200);
  assert.deepEqual(firstBody.toolCalls, [{ id: 'call-1', action: 'browserOpen', args: { url: 'https://example.com' } }]);
  assert.deepEqual(firstBody.chat.messages.at(-1).toolCalls, firstBody.toolCalls);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.browserEnabled, true);
  assert.equal(h.calls[0].options.deviceEnabled, true);
  assert.match(h.calls[0].messages[0].content, /Abra o site/);
  assert.equal(h.calls[0].memories[0].content, 'prefers concise replies');
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[0].revision, 1);
  assert.equal(h.writes[1].revision, 2);

  const second = await chatRoute({ req: request('/api/chat/tool-result', { chatId: 'c1', toolCallId: 'call-1', result: 'Título da página' }), account: h.deps.account, ...h.deps });
  const secondBody = await body(second);
  assert.equal(second.status, 200);
  assert.equal(secondBody.message.content, 'Página aberta.');
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].messages.slice(-2), [
    { role: 'assistant', content: 'Vou abrir.', sources: [], tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'browserOpen', arguments: '{"url":"https://example.com"}' } }] },
    { role: 'tool', tool_call_id: 'call-1', content: 'Título da página' }
  ]);
  assert.equal(h.deps.account.chats[0].pending, undefined);

  const duplicate = await chatRoute({ req: request('/api/chat/tool-result', { chatId: 'c1', toolCallId: 'call-1', result: 'Título da página' }), account: h.deps.account, ...h.deps });
  assert.equal(duplicate.status, 409);
  assert.equal((await body(duplicate)).error.code, 'INVALID_TOOL_RESULT');
  assert.equal(h.calls.length, 2);
});

test('website chat disables native tools and busy chats reject requests', async () => {
  const h = harness();
  const website = await chatRoute({ req: request('/api/chat', { chatId: 'c1', providerId: 'p1', message: 'Olá', nativeAvailable: false }), account: h.deps.account, ...h.deps });
  assert.equal(website.status, 200);
  assert.deepEqual(h.calls[0].options, { nativeAvailable: false, browserEnabled: false, deviceEnabled: false });

  const busyAccount = account();
  busyAccount.chats[0].busyUntil = Date.now() + 60_000;
  const busyHarness = harness(busyAccount);
  const blocked = await chatRoute({ req: request('/api/chat', { chatId: 'c1', providerId: 'p1', message: 'Ainda aí?', nativeAvailable: false }), account: busyHarness.deps.account, ...busyHarness.deps });
  assert.equal(blocked.status, 409);
  assert.equal((await body(blocked)).error.code, 'CHAT_BUSY');
  assert.equal(busyHarness.calls.length, 0);
});

test('publicChat hides tool turns and only shows the currently pending command card', () => {
  const view = publicChat({ id: 'c1', title: 'Teste', options: {}, pending: { id: 'active', action: 'browserSnapshot', args: {} }, messages: [
    { role: 'user', content: 'Veja isto' },
    { role: 'assistant', content: 'Executando', tool_calls: [{ id: 'consumed', function: { name: 'browserOpen', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'consumed', content: 'resultado interno' },
    { role: 'assistant', content: 'Agora', tool_calls: [{ id: 'active', function: { name: 'browserSnapshot', arguments: '{}' } }] }
  ] });
  assert.deepEqual(view.messages, [
    { role: 'user', content: 'Veja isto' },
    { role: 'assistant', content: 'Executando' },
    { role: 'assistant', content: 'Agora', toolCalls: [{ id: 'active', action: 'browserSnapshot', args: {} }] }
  ]);
});
