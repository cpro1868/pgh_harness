#!/usr/bin/env node
import process from 'node:process';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverEntry = path.resolve(__dirname, '../apps/server/src/index.ts');

const args = process.argv.slice(2);
const child = spawn(process.execPath, ['--experimental-strip-types', serverEntry, ...args], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
