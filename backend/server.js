import crypto from 'node:crypto';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { chromium } from './playwright-runtime.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

try { loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const execAsync = promisify(execCallback);
const DEFAULT_ORIGINS = [
  'https://aether-secure.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];
const MAX_BODY_BYTES = '64kb';
const MAX_BUFFER = 1024 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const BROWSER_TIMEOUT_MS = 15_000;
const BROWSER_LAUNCH_TIMEOUT_MS = 20_000;
const SENSITIVE_ENV_NAME = /TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|CREDENTIAL/i;

function parseOrigins(value) {
  if (!value) return DEFAULT_ORIGINS;
  return value.split(',').map((origin) => origin.trim()).filter(Boolean);
}

function isSafeHost(hostHeader) {
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase();
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
    || /^\[::1\](?::\d+)?$/.test(host);
}

function safeMessage(error, fallback = 'Operation failed.') {
  // Never propagate browser/system error text: it can include command lines or URLs.
  return error?.message === 'Browser is not running.' ? error.message : fallback;
}

function structuredError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function validateObject(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

function childEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !SENSITIVE_ENV_NAME.test(name)));
}

export class BrowserManager {
  constructor({ playwright = chromium, env = process.env } = {}) {
    this.playwright = playwright;
    this.env = env;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.queue = Promise.resolve();
  }

  get ready() {
    return Boolean(this.page);
  }

  runExclusive(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  executablePath() {
    if (this.env.CHROMIUM_PATH) return this.env.CHROMIUM_PATH;
    const candidates = [
      '/data/data/com.termux/files/usr/bin/chromium',
      '/data/data/com.termux/files/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    return candidates.find((candidate) => existsSync(candidate)) || 'chromium';
  }

  async start() {
    return this.runExclusive(async () => {
      if (this.page) return { started: false, ready: true };
      const executablePath = this.executablePath();
      try {
        this.browser = await this.playwright.launch({
          headless: true,
          executablePath,
          timeout: BROWSER_LAUNCH_TIMEOUT_MS,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        const browser = this.browser;
        browser.on?.('disconnected', () => {
          if (this.browser === browser) {
            this.page = null;
            this.context = null;
            this.browser = null;
          }
        });
        this.context = await this.browser.newContext();
        this.page = await this.context.newPage();
        this.page.setDefaultTimeout?.(BROWSER_TIMEOUT_MS);
        return { started: true, ready: true };
      } catch (error) {
        await this.closeUnsafe();
        throw error;
      }
    });
  }

  async inject(script) {
    return this.runExclusive(async () => {
      if (!this.page) throw new Error('Browser is not running.');
      let timedOut = false;
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          reject(new Error('Timed out.'));
        }, BROWSER_TIMEOUT_MS);
      });
      try {
        const result = await Promise.race([this.page.evaluate(script), timeout]);
        return result === undefined ? null : result;
      } catch (error) {
        // Evaluation may continue in Chromium after the client-side timeout. Close it
        // directly here (not through runExclusive) to avoid waiting on our own queue.
        if (timedOut) await this.closeUnsafe();
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }

  async navigate(url) {
    return this.runExclusive(async () => {
      if (!this.page) throw new Error('Browser is not running.');
      const response = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT_MS });
      return { url: this.page.url(), status: response?.status?.() ?? null };
    });
  }

  async closeUnsafe() {
    const browser = this.browser;
    this.page = null;
    this.context = null;
    this.browser = null;
    if (browser) await browser.close().catch(() => undefined);
  }

  async stop() {
    return this.runExclusive(async () => {
      const wasReady = this.ready;
      await this.closeUnsafe();
      return { stopped: wasReady };
    });
  }
}

export function createApp(options = {}) {
  const env = options.env ?? process.env;
  const token = options.token ?? env.AETHER_LOCAL_TOKEN ?? '';
  const allowedOrigins = options.allowedOrigins ?? parseOrigins(env.ALLOWED_ORIGINS);
  const commandTimeoutMs = options.commandTimeoutMs ?? Number(env.AETHER_COMMAND_TIMEOUT_MS || DEFAULT_COMMAND_TIMEOUT_MS);
  const browserManager = options.browserManager ?? new BrowserManager({ playwright: options.playwright, env });
  const termuxShell = '/data/data/com.termux/files/usr/bin/bash';
  const commandShell = options.commandShell ?? env.SHELL ?? (existsSync(termuxShell) ? termuxShell : '/bin/sh');
  const commandEnv = childEnvironment(env);
  const redactLocalToken = (value) => {
    const output = String(value ?? '');
    return token ? output.replaceAll(token, '[REDACTED]') : output;
  };
  let shellBusy = false;
  const app = express();

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!isSafeHost(req.headers.host)) {
      return structuredError(res, 421, 'HOST_NOT_ALLOWED', 'Host is not allowed.');
    }
    return next();
  });
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      return structuredError(res, 403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed.');
    }
    return next();
  });
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS' && req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    next();
  });
  app.use(cors({
    origin(origin, callback) { callback(null, origin && allowedOrigins.includes(origin) ? origin : false); },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Aether-Token'],
    optionsSuccessStatus: 204
  }));
  app.use(express.json({ limit: MAX_BODY_BYTES, strict: true }));

  app.get('/health', (req, res) => res.json({ ok: true, browserReady: browserManager.ready }));

  function requireToken(req, res, next) {
    if (token.length < 32) {
      return structuredError(res, 503, 'TOKEN_NOT_CONFIGURED', 'Local API token is not configured.');
    }
    const supplied = req.get('x-aether-token');
    if (!supplied) return structuredError(res, 401, 'UNAUTHORIZED', 'Authentication is required.');
    const expectedBuffer = Buffer.from(token);
    const actualBuffer = Buffer.from(supplied);
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
      return structuredError(res, 401, 'UNAUTHORIZED', 'Authentication is required.');
    }
    return next();
  }

  app.post('/api/exec', requireToken, async (req, res) => {
    if (!validateObject(req.body) || typeof req.body.command !== 'string' || !req.body.command.trim() || req.body.command.length > 32_768) {
      return structuredError(res, 400, 'INVALID_BODY', 'command must be a non-empty string up to 32768 characters.');
    }
    if (shellBusy) return structuredError(res, 429, 'SHELL_BUSY', 'Another command is running.');
    shellBusy = true;
    try {
      const result = await execAsync(req.body.command, { timeout: commandTimeoutMs, maxBuffer: MAX_BUFFER, shell: commandShell, windowsHide: true, env: commandEnv });
      return res.json({ stdout: redactLocalToken(result.stdout), stderr: redactLocalToken(result.stderr), exitCode: 0, timedOut: false });
    } catch (error) {
      return res.json({
        stdout: redactLocalToken(error.stdout),
        stderr: redactLocalToken(error.stderr),
        exitCode: Number.isInteger(error.code) ? error.code : null,
        timedOut: Boolean(error.killed || error.signal === 'SIGTERM')
      });
    } finally {
      shellBusy = false;
    }
  });

  app.post('/api/browser/start', requireToken, async (req, res) => {
    if (!validateObject(req.body)) return structuredError(res, 400, 'INVALID_BODY', 'Body must be a JSON object.');
    try { return res.json(await browserManager.start()); }
    catch (error) { return structuredError(res, 503, 'BROWSER_UNAVAILABLE', safeMessage(error, 'Browser could not be started.')); }
  });

  app.post('/api/browser/inject', requireToken, async (req, res) => {
    if (!validateObject(req.body) || typeof req.body.script !== 'string' || !req.body.script.trim()) {
      return structuredError(res, 400, 'INVALID_BODY', 'script must be a non-empty string.');
    }
    try { return res.json({ result: await browserManager.inject(req.body.script) }); }
    catch (error) { return structuredError(res, error.message === 'Browser is not running.' ? 409 : 504, 'BROWSER_OPERATION_FAILED', safeMessage(error)); }
  });

  app.post('/api/browser/navigate', requireToken, async (req, res) => {
    if (!validateObject(req.body) || typeof req.body.url !== 'string') return structuredError(res, 400, 'INVALID_BODY', 'url must be a string.');
    let url;
    try { url = new URL(req.body.url); } catch { return structuredError(res, 400, 'INVALID_URL', 'url must be a valid HTTP or HTTPS URL.'); }
    if (!['http:', 'https:'].includes(url.protocol)) return structuredError(res, 400, 'INVALID_URL', 'url must be a valid HTTP or HTTPS URL.');
    try { return res.json(await browserManager.navigate(url.toString())); }
    catch (error) { return structuredError(res, error.message === 'Browser is not running.' ? 409 : 504, 'BROWSER_OPERATION_FAILED', safeMessage(error)); }
  });

  app.post('/api/browser/stop', requireToken, async (req, res) => {
    if (!validateObject(req.body)) return structuredError(res, 400, 'INVALID_BODY', 'Body must be a JSON object.');
    return res.json(await browserManager.stop());
  });

  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError || error.type === 'entity.parse.failed') return structuredError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON.');
    if (error.type === 'entity.too.large') return structuredError(res, 413, 'BODY_TOO_LARGE', 'Request body is too large.');
    return structuredError(res, 500, 'INTERNAL_ERROR', 'Internal server error.');
  });
  app.locals.browserManager = browserManager;
  return app;
}

export function startServer(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  const app = createApp(options);
  const server = app.listen(port, host, () => console.log(`Aether local backend listening on http://${host}:${port}`));
  if (options.installSignalHandlers !== false) {
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      const forceExit = setTimeout(() => process.exit(0), 5_000);
      forceExit.unref();
      Promise.resolve(app.locals.browserManager.stop())
        .catch(() => undefined)
        .finally(() => server.close(() => process.exit(0)));
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }
  return server;
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) startServer();
