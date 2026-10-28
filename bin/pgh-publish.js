#!/usr/bin/env node
// PG Harness 发布版入口：运行预编译 JS（无需 --experimental-strip-types）。
// 用法: pgh [--port 3210] ；数据目录 ~/.pg_harness（可用 PGH_DATA_DIR 覆盖）
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(__dirname, '../dist-publish/apps/server/src/index.js');

const args = process.argv.slice(2);
const child = spawn(process.execPath, [serverEntry, ...args], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
