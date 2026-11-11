import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp, BrowserManager } from '../backend/server.js';
import { chromium } from '../backend/playwright-runtime.js';

const token = crypto.randomBytes(32).toString('base64url');
const allowedOrigins = [];
const manager = new BrowserManager();
const api = http.createServer(createApp({ token, allowedOrigins, browserManager: manager }));
const site = express();
site.use(express.static(fileURLToPath(new URL('../frontend/dist/', import.meta.url))));
site.get('/fixture', (_req, res) => res.type('html').send('<!doctype html><title>Aether browser test</title><h1>Local fixture</h1>'));
const web = http.createServer(site);
const listen = (server) => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = (server) => new Promise(resolve => server.close(() => resolve()));
await listen(api); await listen(web);
const backend = `http://127.0.0.1:${api.address().port}`;
const origin = `http://127.0.0.1:${web.address().port}`;
const screenshots = '/home/daytona/workspace/output/aether-agent-validation';
allowedOrigins.push(origin);

async function post(path, body = {}) {
  const response = await fetch(backend + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-aether-token': token, Origin: origin },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(data)}`);
  return data;
}
async function noOverflow(page, widths = [320, 390, 768, 1440]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `horizontal overflow at ${width}px`);
  }
}

let ui;
try {
  // Real local backend contract: shell plus the actual Chromium lifecycle.
  const command = await post('/api/exec', { command: 'node --version' });
  assert.equal(command.exitCode, 0);
  assert.match(command.stdout, /^v\d+\.\d+\.\d+/);
  assert.equal((await post('/api/browser/start')).ready, true);
  assert.equal((await post('/api/browser/navigate', { url: `${origin}/fixture` })).status, 200);
  assert.equal((await post('/api/browser/inject', { script: 'document.title' })).result, 'Aether browser test');
  assert.equal((await post('/api/browser/inject', { script: 'Promise.resolve(2 + 2)' })).result, 4);
  assert.equal((await post('/api/browser/stop')).stopped, true);
  console.log('PASS backend: /exec node --version; browser start, navigate, inject and stop use real Chromium.');

  await mkdir(screenshots, { recursive: true });
  ui = await chromium.launch({ executablePath: manager.executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await ui.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let completionCalls = 0;
  let execCalls = 0;
  let releaseSlowResponse;

  // Cloud stays unauthenticated by default. Requests to the local backend remain real.
  await page.route('**/api/**', async route => {
    if (route.request().url().startsWith(backend)) return route.continue();
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Entre na sua conta para continuar.' }) });
  });
  await page.route('https://api.openai.com/v1/chat/completions', async route => {
    completionCalls += 1;
    const request = route.request();
    assert.equal(await request.headerValue('authorization'), 'Bearer test-key-not-real');
    const payload = request.postDataJSON();
    if (completionCalls === 1) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-approve', type: 'function', function: { name: 'run_termux_command', arguments: JSON.stringify({ command: 'node --version' }) } }] } }] }) });
    }
    if (completionCalls === 2) {
      assert.ok(payload.messages.some(message => message.role === 'tool' && /v\d+\.\d+/.test(message.content)), 'approved tool result must continue to the model');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Diagnóstico concluído.' } }] }) });
    }
    if (completionCalls === 3) {
      assert.ok(payload.messages.some(message => message.content === 'Diagnóstico concluído.'), 'second turn must retain prior history');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-reject', type: 'function', function: { name: 'run_termux_command', arguments: JSON.stringify({ command: 'node --version' }) } }] } }] }) });
    }
    if (completionCalls === 4) {
      assert.ok(payload.messages.some(message => message.role === 'tool' && /Recusado pelo usuário/.test(message.content)), 'rejection must continue with a tool result');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Execução recusada.' } }] }) });
    }
    // A held fifth response exposes the visible Stop action; it is released after Stop.
    return new Promise(resolve => { releaseSlowResponse = () => resolve(route.abort()); });
  });
  await page.route(`${backend}/api/exec`, async route => { execCalls += 1; await route.continue(); });

  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Entrar no modo local/i }).click();
  await page.getByRole('button', { name: 'Abrir configurações' }).click();
  await page.getByRole('button', { name: 'Local', exact: true }).click();
  await page.getByLabel('URL base do provedor').fill('https://api.openai.com/v1');
  await page.getByLabel('Modelo').fill('test-model');
  await page.getByLabel('Chave da API').fill('test-key-not-real');
  await page.getByLabel('Backend local').fill(backend);
  await page.getByLabel('Token do backend').fill(token);
  await page.getByRole('button', { name: 'Salvar nesta sessão' }).click();
  await page.getByText('Configuração local salva nesta sessão.', { exact: true }).waitFor();
  await page.waitForTimeout(400); // Capture only after the slide-in animation settles.
  const panelBounds = await page.locator('.settings-panel').boundingBox();
  assert.ok(panelBounds.x >= 0 && panelBounds.x + panelBounds.width <= 391, 'settings panel must fit the mobile viewport');
  await page.screenshot({ path: `${screenshots}/settings-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Fechar configurações' }).click();
  await page.getByText('Agente Online', { exact: true }).waitFor();
  await page.screenshot({ path: `${screenshots}/mobile.png`, fullPage: true });

  const box = page.getByRole('textbox', { name: 'Mensagem' });
  await box.fill('Verifique a versão do Node.');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await page.getByRole('button', { name: 'Aprovar execução' }).waitFor();
  assert.equal(completionCalls, 1, 'tool must wait for approval');
  assert.equal(execCalls, 0, 'tool must not execute before approval');
  await page.getByRole('button', { name: 'Aprovar execução' }).click();
  await page.getByText('Diagnóstico concluído.', { exact: true }).waitFor();
  assert.equal(execCalls, 1, 'approved tool must use real local /exec once');

  await box.fill('Continue usando o resultado anterior.');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await page.getByRole('button', { name: 'Recusar', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Recusar', exact: true }).click();
  await page.getByText('Execução recusada.', { exact: true }).waitFor();
  assert.equal(execCalls, 1, 'rejected tool must not execute');
  await page.screenshot({ path: `${screenshots}/chat-mobile.png`, fullPage: true });

  await box.fill('Inicie e pare esta solicitação.');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await page.getByRole('button', { name: 'Interromper operação' }).click();
  releaseSlowResponse?.();
  await page.getByText('Operação cancelada.', { exact: true }).waitFor();
  assert.equal(completionCalls, 5, 'stop scenario must begin the fifth request');

  // Remove the provider mock: Chromium now produces an actual offline fetch failure.
  await page.unroute('https://api.openai.com/v1/chat/completions');
  await page.context().setOffline(true);
  await box.fill('Teste offline.');
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await page.getByRole('status').filter({ hasText: 'Sem internet' }).waitFor();
  await page.getByRole('alert').filter({ hasText: 'Não foi possível contactar o provedor local.' }).waitFor();
  await page.context().setOffline(false);

  await noOverflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${screenshots}/desktop.png`, fullPage: true });
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
  console.log(`PASS UI: local setup, cloud 401 default, approval/real exec/continuation, history, rejection, stop, offline and overflow (${completionCalls} mocked completions, ${execCalls} real exec).`);
  console.log(`PASS screenshots: ${screenshots}/{mobile,desktop,settings-mobile,chat-mobile}.png`);
  console.log('NOTE: fake token/key are test-only; no provider key was used.');
} finally {
  await ui?.close();
  await manager.stop();
  await close(api); await close(web);
}
