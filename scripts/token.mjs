import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const tokenPath = path.join(scriptDir, '..', 'backend', '.local-token.txt');

try {
  const token = (await readFile(tokenPath, 'utf8')).trim();
  if (!token) throw new Error('empty token');
  process.stdout.write(token + '\n');
} catch {
  process.stderr.write('Token local indisponível. Execute primeiro: node scripts/setup.mjs\n');
  process.exitCode = 1;
}
