import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_SKIP_DIRS } from "../../../core/src/workspace-skip.js";
function globToRegExp(pattern) {
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
            }
            else {
                re += '[^/\\\\]*';
                i += 1;
            }
        }
        else if (c === '?') {
            re += '[^/\\\\]';
            i += 1;
        }
        else {
            re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            i += 1;
        }
    }
    return new RegExp(`^${re}$`);
}
export class SearchTools {
    workspacePath;
    // 统一屏蔽清单（workspace-skip.ts 单一来源）+ 隐藏目录兜底
    static SKIP_DIRS = WORKSPACE_SKIP_DIRS;
    constructor(workspacePath) {
        this.workspacePath = path.resolve(workspacePath);
    }
    glob(pattern, limit = 200) {
        const matcher = globToRegExp(pattern.replace(/\\/g, '/'));
        const results = [];
        const walk = (dir) => {
            if (results.length >= limit)
                return;
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const entry of entries) {
                if (results.length >= limit)
                    return;
                if (entry.isDirectory() && (SearchTools.SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')))
                    continue;
                const full = path.join(dir, entry.name);
                const rel = path.relative(this.workspacePath, full).replace(/\\/g, '/');
                if (entry.isDirectory()) {
                    walk(full);
                }
                else if (matcher.test(rel) || matcher.test(entry.name)) {
                    results.push(rel);
                }
            }
        };
        walk(this.workspacePath);
        return results;
    }
    grep(regex, limit = 200) {
        const re = new RegExp(regex);
        const hits = [];
        const walk = (dir) => {
            if (hits.length >= limit)
                return;
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const entry of entries) {
                if (hits.length >= limit)
                    return;
                if (entry.isDirectory() && (SearchTools.SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')))
                    continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                    continue;
                }
                let content;
                try {
                    const stat = fs.statSync(full);
                    if (stat.size > 1024 * 1024)
                        continue;
                    content = fs.readFileSync(full, 'utf8');
                }
                catch {
                    continue;
                }
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i += 1) {
                    if (re.test(lines[i])) {
                        hits.push({ file: path.relative(this.workspacePath, full), line: i + 1, text: lines[i].slice(0, 200) });
                        if (hits.length >= limit)
                            return;
                    }
                }
            }
        };
        walk(this.workspacePath);
        return hits;
    }
}
