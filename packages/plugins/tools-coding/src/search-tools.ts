import fs from 'node:fs';
import path from 'node:path';

export interface SearchHit {
  file: string;
  line?: number;
  text?: string;
}

function globToRegExp(pattern: string): RegExp {
  // 最小可用 glob: 支持 **、*、?，其余字面匹配
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (pattern[i] === '/') {
          re += '/?';
          i += 1;
        }
      } else {
        re += '[^/\\\\]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/\\\\]';
      i += 1;
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

export class SearchTools {
  public readonly workspacePath: string;
  private static readonly SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

  constructor(workspacePath: string) {
    this.workspacePath = path.resolve(workspacePath);
  }

  public glob(pattern: string, limit = 200): string[] {
    const matcher = globToRegExp(pattern.replace(/\\/g, '/'));
    const results: string[] = [];
    const walk = (dir: string): void => {
      if (results.length >= limit) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= limit) return;
        if (entry.isDirectory() && SearchTools.SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(this.workspacePath, full).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          walk(full);
        } else if (matcher.test(rel) || matcher.test(entry.name)) {
          results.push(rel);
        }
      }
    };
    walk(this.workspacePath);
    return results;
  }

  public grep(regex: string, limit = 200): SearchHit[] {
    const re = new RegExp(regex);
    const hits: SearchHit[] = [];
    const walk = (dir: string): void => {
      if (hits.length >= limit) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (hits.length >= limit) return;
        if (entry.isDirectory() && SearchTools.SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        let content: string;
        try {
          const stat = fs.statSync(full);
          if (stat.size > 1024 * 1024) continue;
          content = fs.readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          if (re.test(lines[i] as string)) {
            hits.push({ file: path.relative(this.workspacePath, full), line: i + 1, text: (lines[i] as string).slice(0, 200) });
            if (hits.length >= limit) return;
          }
        }
      }
    };
    walk(this.workspacePath);
    return hits;
  }
}
