import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, copyFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('setup creates owner-only secrets without printing them and preserves them on rerun', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aether-setup-'));
  try {
    await mkdir(path.join(dir, 'scripts'));
    const script = path.join(dir, 'scripts/setup.mjs');
    await copyFile(new URL('../scripts/setup.mjs', import.meta.url), script);
    const out = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    const env = await readFile(path.join(dir, 'backend/.env'), 'utf8');
    const token = (await readFile(path.join(dir, 'backend/.local-token.txt'), 'utf8')).trim();
    assert.equal(token.length, 43);
    assert.ok(env.includes('AETHER_LOCAL_TOKEN=' + token));
    assert.equal(out.includes(token), false);
    assert.equal((await stat(path.join(dir, 'backend/.env'))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(dir, 'backend/.local-token.txt'))).mode & 0o777, 0o600);
    execFileSync(process.execPath, [script], { stdio: 'pipe' });
    assert.equal(await readFile(path.join(dir, 'backend/.env'), 'utf8'), env);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
