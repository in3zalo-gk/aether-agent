import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after } from 'node:test';
import { BrowserManager, createApp } from '../backend/server.js';

const TOKEN = 'test-token-with-at-least-thirty-two-characters';
const app = createApp({ token: TOKEN, commandTimeoutMs: 100 });
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

function request(path, { method = 'GET', headers = {}, body } = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: { Host: `127.0.0.1:${port}`, ...headers },
    body
  });
}

function protectedJson(path, body, headers = {}) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-aether-token': TOKEN, ...headers },
    body: JSON.stringify(body)
  });
}

test('health is public and exposes only readiness state', async () => {
  const response = await request('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, browserReady: false });
});

test('protected API requires the local token', async () => {
  const response = await request('/api/exec', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
});

test('rejects a DNS-rebinding host header', async () => {
  const response = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/health', headers: { Host: 'evil.example' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(response.status, 421);
  assert.equal(JSON.parse(response.body).error.code, 'HOST_NOT_ALLOWED');
});

test('rejects an origin outside the explicit allowlist', async () => {
  const response = await request('/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ORIGIN_NOT_ALLOWED');
});

test('allowed private-network preflight receives exact CORS and PNA headers', async () => {
  const origin = 'http://localhost:5173';
  const response = await request('/api/exec', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,x-aether-token',
      'access-control-request-private-network': 'true'
    }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-private-network'), 'true');
  assert.match(response.headers.get('access-control-allow-headers'), /x-aether-token/i);
});

test('validates JSON endpoint bodies', async () => {
  const response = await protectedJson('/api/exec', { command: '' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_BODY');
});

test('executes a benign local command and returns its output contract', async () => {
  const response = await protectedJson('/api/exec', { command: 'printf aether-test' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stdout: 'aether-test', stderr: '', exitCode: 0, timedOut: false });
});

test('returns a structured timeout result instead of a 500', async () => {
  const response = await protectedJson('/api/exec', { command: 'sleep 1' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.timedOut, true);
  assert.equal(body.exitCode, null);
});

class FakeBrowser {
  constructor(page) {
    this.page = page;
    this.listeners = new Map();
    this.closed = false;
  }

  on(event, listener) {
    this.listeners.set(event, listener);
  }

  emit(event) {
    this.listeners.get(event)?.();
  }

  async newContext() {
    return {
      newPage: async () => this.page
    };
  }

  async close() {
    this.closed = true;
  }
}

test('BrowserManager lifecycle starts, navigates, awaits injection, stops, and clears after disconnect', async () => {
  let launchOptions;
  const page = {
    setDefaultTimeout(timeout) { this.timeout = timeout; },
    url: () => 'https://example.test/final',
    goto: async (url, options) => {
      assert.equal(url, 'https://example.test/');
      assert.equal(options.waitUntil, 'domcontentloaded');
      return { status: () => 201 };
    },
    evaluate: async () => Promise.resolve('injection-resolved')
  };
  const browser = new FakeBrowser(page);
  const manager = new BrowserManager({
    playwright: {
      launch: async (options) => {
        launchOptions = options;
        return browser;
      }
    },
    env: {}
  });

  assert.deepEqual(await manager.start(), { started: true, ready: true });
  assert.equal(manager.ready, true);
  assert.equal(launchOptions.timeout, 20_000);
  assert.ok(launchOptions.args.includes('--disable-dev-shm-usage'));
  assert.deepEqual(await manager.navigate('https://example.test/'), { url: 'https://example.test/final', status: 201 });
  assert.equal(await manager.inject('Promise.resolve()'), 'injection-resolved');
  assert.deepEqual(await manager.start(), { started: false, ready: true });

  assert.deepEqual(await manager.stop(), { stopped: true });
  assert.equal(browser.closed, true);
  assert.deepEqual(await manager.start(), { started: true, ready: true });
  browser.emit('disconnected');
  assert.equal(manager.ready, false);
  assert.deepEqual(await manager.stop(), { stopped: false });
});

test('BrowserManager rejects navigate and inject before start', async () => {
  const manager = new BrowserManager({ playwright: { launch: async () => { throw new Error('not reached'); } }, env: {} });
  await assert.rejects(manager.navigate('https://example.test/'), /Browser is not running/);
  await assert.rejects(manager.inject('1 + 1'), /Browser is not running/);
});

test('rejects whitespace-only commands', async () => {
  const response = await protectedJson('/api/exec', { command: '   ' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_BODY');
});

test('rejects protected calls when configured token is too short', async () => {
  const badApp = createApp({ token: 'too-short' });
  const badServer = http.createServer(badApp);
  await new Promise((resolve) => badServer.listen(0, '127.0.0.1', resolve));
  try {
    const { port: badPort } = badServer.address();
    const response = await fetch(`http://127.0.0.1:${badPort}/api/exec`, {
      method: 'POST',
      headers: {
        Host: `127.0.0.1:${badPort}`,
        'content-type': 'application/json',
        'x-aether-token': TOKEN
      },
      body: JSON.stringify({ command: 'printf ignored' })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'TOKEN_NOT_CONFIGURED');
  } finally {
    await new Promise((resolve, reject) => badServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('redacts the configured local token from command output', async () => {
  const response = await protectedJson('/api/exec', { command: `printf '${TOKEN}'` });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { stdout: '[REDACTED]', stderr: '', exitCode: 0, timedOut: false });
});

test('does not pass token or secret-named variables into the child shell', async () => {
  const isolatedApp = createApp({
    token: TOKEN,
    env: { PATH: process.env.PATH, AETHER_LOCAL_TOKEN: TOKEN, DEMO_SECRET: 'not-for-child' },
    commandShell: '/bin/sh'
  });
  const isolatedServer = http.createServer(isolatedApp);
  await new Promise((resolve) => isolatedServer.listen(0, '127.0.0.1', resolve));
  try {
    const { port: isolatedPort } = isolatedServer.address();
    const response = await fetch(`http://127.0.0.1:${isolatedPort}/api/exec`, {
      method: 'POST',
      headers: {
        Host: `127.0.0.1:${isolatedPort}`,
        'content-type': 'application/json',
        'x-aether-token': TOKEN
      },
      body: JSON.stringify({ command: 'printf "$AETHER_LOCAL_TOKEN:$DEMO_SECRET"' })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { stdout: ':', stderr: '', exitCode: 0, timedOut: false });
  } finally {
    await new Promise((resolve, reject) => isolatedServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('BrowserManager closes the browser when injection times out', async () => {
  const page = {
    setDefaultTimeout() {},
    evaluate: () => new Promise(() => {})
  };
  const browser = new FakeBrowser(page);
  const manager = new BrowserManager({ playwright: { launch: async () => browser }, env: {} });
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay === 15_000 ? 0 : delay, ...args);
  try {
    await manager.start();
    await assert.rejects(manager.inject('while (true) {}'), /Timed out/);
    assert.equal(browser.closed, true);
    assert.equal(manager.ready, false);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});
