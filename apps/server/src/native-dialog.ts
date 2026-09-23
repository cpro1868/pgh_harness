import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface DirectoryEntry {
  name: string;
  path: string;
  hidden: boolean;
}

export interface DirectoryListing {
  current: string;
  crumbs: DirectoryEntry[];
  entries: DirectoryEntry[];
  home: string;
}

/**
 * 列出指定绝对路径下的目录子项，并计算面包屑导航 (参考 deepseek-harness browse 架构)
 */
export async function listDirectory(targetPath?: string): Promise<DirectoryListing> {
  const home = os.homedir();
  const current = targetPath ? path.resolve(targetPath) : home;

  // 生成面包屑路径链
  const crumbs: DirectoryEntry[] = [];
  let curr = current;
  while (true) {
    const parent = path.dirname(curr);
    const isRoot = parent === curr;
    crumbs.unshift({
      name: isRoot ? curr : path.basename(curr) || curr,
      path: curr,
      hidden: false,
    });
    if (isRoot) break;
    curr = parent;
  }

  // 读取当前目录下所有子项（只保留目录）
  const entries: DirectoryEntry[] = [];
  try {
    const dir = await fs.promises.opendir(current);
    for await (const dirent of dir) {
      if (dirent.isDirectory()) {
        const full = path.join(current, dirent.name);
        const isHidden = dirent.name.startsWith('.');
        entries.push({
          name: dirent.name,
          path: full,
          hidden: isHidden,
        });
      }
    }
    // 字母排序
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  } catch (err) {
    // 权限不足或其他错误时返回空 entries
  }

  return {
    current,
    crumbs,
    entries,
    home,
  };
}

/**
 * 在目标目录下创建新子目录
 */
export async function createDirectory(parentPath: string, name: string): Promise<string> {
  const cleanName = name.trim();
  if (!cleanName || cleanName === '.' || cleanName === '..' || /[\\/]/.test(cleanName)) {
    throw new Error('目录名称不合法，不能包含斜杠或特殊符号');
  }
  const newPath = path.join(parentPath, cleanName);
  await fs.promises.mkdir(newPath, { recursive: false });
  return newPath;
}

/**
 * 唤起 Windows 原生高集成度现代对话框：
 * 采用 C# STA 脚本编译执行 FolderBrowserDialog，确保在最前激活并返回绝对路径
 */
export function openNativeFolderDialog(): string {
  const isWin = process.platform === 'win32';
  if (!isWin) return '';

  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "请选择本地代码工程物理工作区 (Purple Grapes Harness)"
$dialog.ShowNewFolderButton = $true
$dialog.RootFolder = [System.Environment+SpecialFolder]::MyComputer

$topForm = New-Object System.Windows.Forms.Form
$topForm.TopMost = $true
$topForm.ShowInTaskbar = $false
$topForm.WindowState = [System.Windows.Forms.FormWindowState]::Minimized

$result = $dialog.ShowDialog($topForm)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dialog.SelectedPath
}
$topForm.Dispose()
$dialog.Dispose()
`.trim().replace(/\r?\n/g, '; ');

  try {
    const stdout = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -Command "${psScript}"`, {
      encoding: 'utf8',
      windowsHide: false,
      timeout: 120000,
    });
    return stdout.trim().split(/\r?\n/).pop()?.trim() || '';
  } catch (err) {
    return '';
  }
}

