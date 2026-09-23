import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HarnessServer } from '../src/index.ts';

test('TC-01-08-006: staticDir follows source location, independent of process CWD', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-static-test-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-static-data-'));
  const originalCwd = process.cwd();
  process.chdir(tmpDir);

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const server = new HarnessServer({ port: 3299, dataDir });
  assert.ok(fs.existsSync(server.staticDir), `staticDir must exist even when CWD=${tmpDir}`);
  assert.ok(
    fs.existsSync(path.join(server.staticDir, 'run-chat.html')),
    'run-chat.html must resolve from any CWD (regression: scripts/*.ps1 launch from any directory)',
  );
  await server.db.close();
});
