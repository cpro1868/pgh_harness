import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileTools, FileNotObservedError, EditMismatchError } from '../src/file-tools.ts';

test('TC-01-04-001 & TC-01-04-002: 换行符容错(CRLF/LF)精密替换、先读后写与失败熔断测试', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-file-tools-'));
  const tools = new FileTools(tmpDir);

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('TC-01-04-002: 未读过的文件严禁直接修改 (先读后写)', () => {
    const filePath = 'unobserved.ts';
    fs.writeFileSync(path.join(tmpDir, filePath), 'const a = 1;\n', 'utf8');

    assert.throws(
      () => {
        tools.editFile(filePath, 'const a = 1;', 'const a = 2;');
      },
      (err: unknown) => {
        assert.ok(err instanceof FileNotObservedError);
        return true;
      }
    );
  });

  await t.test('TC-01-04-001: Windows CRLF 文件精密替换且不改变原有换行符', () => {
    const filePath = 'crlf-file.ts';
    // 写入真实的 Windows \r\n 换行文件
    const crlfContent = 'function calc() {\r\n  const val = 10;\r\n  return val;\r\n}\r\n';
    fs.writeFileSync(path.join(tmpDir, filePath), crlfContent, 'utf8');

    // 1. 先读建立基线
    const readResult = tools.readFile(filePath);
    assert.ok(readResult.includes('calc()'));

    // 2. 模拟 LLM 传入的纯 \n 格式的 oldString 进行替换
    const oldString = '  const val = 10;\n  return val;';
    const newString = '  const val = 20;\n  return val * 2;';

    const editResult = tools.editFile(filePath, oldString, newString);
    assert.equal(editResult.replacements, 1);

    // 3. 读取物理文件检验内容与换行符保持
    const updatedContent = fs.readFileSync(path.join(tmpDir, filePath), 'utf8');
    assert.ok(updatedContent.includes('const val = 20;'));
    assert.ok(updatedContent.includes('\r\n'), '必须保持原有的 CRLF 换行符');
    assert.equal(updatedContent.includes('\r\r\n'), false, '严禁产生畸形双回车换行');
  });

  await t.test('连续匹配失败 3 次触发局部修改失败熔断保护 (D46)', () => {
    const filePath = 'fail-test.ts';
    fs.writeFileSync(path.join(tmpDir, filePath), 'hello world\n', 'utf8');
    tools.readFile(filePath);

    // 第 1 次失败
    assert.throws(() => tools.editFile(filePath, 'not_exist_1', 'new'), EditMismatchError);
    // 第 2 次失败
    assert.throws(() => tools.editFile(filePath, 'not_exist_2', 'new'), EditMismatchError);
    // 第 3 次失败触发熔断
    assert.throws(() => tools.editFile(filePath, 'not_exist_3', 'new'), (err: any) => {
      assert.ok(err instanceof EditMismatchError);
      assert.equal(err.isDoomLoop, true);
      return true;
    });
  });
});
