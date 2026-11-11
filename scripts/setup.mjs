import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const backendDir = path.join(rootDir, 'backend');
const envPath = path.join(backendDir, '.env');
const tokenPath = path.join(backendDir, '.local-token.txt');

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function firstExisting(paths) {
  return paths.find((candidate) => existsSync(candidate));
}

async function secureWrite(file, content) {
  await writeFile(file, content, { encoding: 'utf8', mode: 0o600 });
  await chmod(file, 0o600);
}

await mkdir(backendDir, { recursive: true });
const existingEnv = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
const values = parseEnv(existingEnv);
const additions = [];

let token = values.get('AETHER_LOCAL_TOKEN');
if (!token) {
  token = crypto.randomBytes(32).toString('base64url');
  additions.push('AETHER_LOCAL_TOKEN=' + token);
}

if (!values.has('ALLOWED_ORIGINS')) {
  additions.push('ALLOWED_ORIGINS=https://aether-secure.pages.dev,http://localhost:5173,http://127.0.0.1:5173');
}

if (!values.has('CHROMIUM_PATH')) {
  const chromium = firstExisting([
    '/data/data/com.termux/files/usr/bin/chromium-browser',
    '/data/data/com.termux/files/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ]);
  if (chromium) additions.push('CHROMIUM_PATH=' + chromium);
}

if (!values.has('PORT')) additions.push('PORT=3000');

if (additions.length) {
  const separator = existingEnv && !existingEnv.endsWith('\n') ? '\n' : '';
  await secureWrite(envPath, existingEnv + separator + additions.join('\n') + '\n');
} else if (existsSync(envPath)) {
  await chmod(envPath, 0o600);
}

await secureWrite(tokenPath, token + '\n');

console.log('Configuração local pronta.');
console.log('backend/.env e backend/.local-token.txt foram protegidos (0600).');
console.log('O token não foi exibido. Para vê-lo conscientemente: node scripts/token.mjs');
console.log('Inicie com: cd backend && node server.js');
