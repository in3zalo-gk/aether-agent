import test from 'node:test';
import assert from 'node:assert/strict';
import { runModel } from './model.js';

function reply(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('preserves /v1 base, keeps bounded history and sends opted-in memory', async () => {
  let seen;
  const fetcher = async (url, init) => { seen = { url, body: JSON.parse(init.body), init }; return reply({ choices: [{ message: { content: 'ok' } }] }); };
  const messages = Array.from({ length: 26 }, (_, i) => ({ role: 'user', content: `m${i}` }));
  const result = await runModel({ provider: { format: 'openai', baseUrl: 'https://api.example/v1/', model: 'x' }, key: 'secret', messages, settings: { memoryEnabled: true, tone: 'brief', systemPrompt: 'be useful' }, memories: [{ content: 'likes tea' }], fetcher });
  assert.equal(seen.url, 'https://api.example/v1/chat/completions');
  assert.equal(seen.init.redirect, 'manual');
  assert.match(seen.body.messages[0].content, /untrusted data/);
  assert.match(seen.body.messages[0].content, /likes tea/);
  assert.equal(seen.body.messages.slice(1).length, 24);
  assert.equal(result.message.content, 'ok');
});

test('omits all tools when native features are unavailable', async () => {
  let body;
  await runModel({ provider: { format: 'openai', baseUrl: 'https://api.example', model: 'x' }, key: 'secret', messages: [{ role: 'user', content: 'hi' }], options: { browserEnabled: true, deviceEnabled: true }, nativeAvailable: false, fetcher: async (_, init) => { body = JSON.parse(init.body); return reply({ choices: [{ message: { content: 'ok', tool_calls: [{ id: 'x', function: { name: 'browserOpen', arguments: '{"url":"https://x"}' } }] } }] }); } });
  assert.equal('tools' in body, false);
  assert.equal('tool_choice' in body, false);
});

test('normalizes one valid native tool call and rejects invalid extras', async () => {
  const result = await runModel({ provider: { format: 'openai', baseUrl: 'https://api.example', model: 'x' }, key: 'secret', messages: [{ role: 'user', content: 'open it' }], options: { browserEnabled: true }, nativeAvailable: true, fetcher: async (_, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.tool_choice, 'auto');
    assert.deepEqual(body.tools.map(x => x.function.name), ['browserOpen', 'browserNavigate', 'browserSnapshot', 'browserClick', 'browserType']);
    return reply({ choices: [{ message: { content: '', tool_calls: [
      { id: 'one', type: 'function', function: { name: 'browserClick', arguments: '{"selector":7}' } },
      { id: 'two', type: 'function', function: { name: 'browserType', arguments: '{"selector":"a","text":"b","extra":true}' } }
    ] } }] });
  } });
  assert.deepEqual(result.toolCalls, [{ id: 'one', action: 'browserClick', args: { selector: 7 } }]);
  assert.equal(result.message.tool_calls.length, 1);
});

test('converts normalized tool history and calls for Anthropic', async () => {
  let body;
  const out = await runModel({ provider: { format: 'anthropic', baseUrl: 'https://api.example/v1', model: 'claude' }, key: 'secret', messages: [
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', function: { name: 'browserSnapshot', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'site text' }
  ], options: { browserEnabled: true }, nativeAvailable: true, fetcher: async (url, init) => { assert.equal(url, 'https://api.example/v1/messages'); body = JSON.parse(init.body); return reply({ content: [{ type: 'text', text: 'done' }, { type: 'tool_use', id: 'call_2', name: 'browserSnapshot', input: {} }] }); } });
  assert.equal(body.messages[0].content[0].type, 'tool_use');
  assert.equal(body.messages[1].content[0].type, 'tool_result');
  assert.deepEqual(out.toolCalls, [{ id: 'call_2', action: 'browserSnapshot', args: {} }]);
});
