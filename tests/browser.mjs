import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { createApp, BrowserManager } from '../backend/server.js';
import { chromium } from '../backend/playwright-runtime.js';

const token = crypto.randomBytes(32).toString('base64url');
const allowedOrigins = [];
const manager = new BrowserManager();
const api = http.createServer(createApp({ token, allowedOrigins, browserManager: manager }));
const site = express();
site.use(express.static(fileURLToPath(new URL('../frontend/dist/', import.meta.url))));
site.get('/fixture', (_req, res) => res.send('<title>Aether browser test</title><h1>Local fixture</h1>'));
const web = http.createServer(site);
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', r));
const close = s => new Promise(r => s.close(r));
await listen(api); await listen(web);
const backend = `http://127.0.0.1:${api.address().port}`;
const origin = `http://127.0.0.1:${web.address().port}`;
allowedOrigins.push(origin);
async function post(path, body = {}) {
  const r = await fetch(backend + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-aether-token': token, Origin: origin }, body: JSON.stringify(body) });
  const data = await r.json(); assert.equal(r.status, 200, JSON.stringify(data)); return data;
}
let ui;
try {
  assert.equal((await post('/api/exec', { command: 'node --version' })).exitCode, 0);
  assert.equal((await post('/api/browser/start')).ready, true);
  assert.equal((await post('/api/browser/navigate', { url: origin + '/fixture' })).status, 200);
  assert.equal((await post('/api/browser/inject', { script: 'document.title' })).result, 'Aether browser test');
  assert.equal((await post('/api/browser/inject', { script: 'Promise.resolve(2 + 2)' })).result, 4);
  assert.equal((await post('/api/browser/stop')).stopped, true);
  console.log('PASS: Chromium real, navegação, JavaScript assíncrono, encerramento e shell.');
  ui = await chromium.launch({ executablePath: manager.executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await ui.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ token, backend }) => {
    localStorage.setItem('aether-settings', JSON.stringify({ provider: 'deepseek', backendUrl: backend, rememberKey: true, storeToken: true }));
    localStorage.setItem('aether-key', 'test-ui-key');
    sessionStorage.setItem('aether-token', token);
  }, { token, backend });
  let calls = 0;
  await page.route('https://api.deepseek.com/chat/completions', async route => {
    calls++;
    const body = route.request().postDataJSON();
    if (calls === 3) assert.ok(body.messages.some(m => m.role === 'tool'), 'Tool history must survive the next user turn');
    const message = calls === 1 ? { role: 'assistant', content: null, tool_calls: [{ id: 'call-test', type: 'function', function: { name: 'run_termux_command', arguments: JSON.stringify({ command: 'node --version' }) } }] } : { role: 'assistant', content: calls === 2 ? 'Diagnóstico concluído.' : 'Histórico preservado.' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message }] }) });
  });
  await page.goto(origin);
  await page.getByText('Backend conectado', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Mensagem', exact: true }).fill('Verifique a versão do Node.');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.getByRole('button', { name: 'Aprovar', exact: true }).waitFor();
  assert.equal(calls, 1, 'Agent must stop for approval before running a tool');
  await page.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await page.getByText('Diagnóstico concluído.', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Mensagem', exact: true }).fill('Continue usando o resultado anterior.');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.getByText('Histórico preservado.', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile viewport must not overflow');
  console.log('PASS: UI mobile, BYOK simulado, aprovação humana, execução real e histórico entre mensagens.');
  console.log('NOTE: Provedor de IA simulado; não valida chave real nem Termux físico.');
} finally {
  await ui?.close(); await manager.stop(); await close(api); await close(web);
}
