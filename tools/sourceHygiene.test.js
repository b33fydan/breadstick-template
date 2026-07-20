// tools/sourceHygiene.test.js — tracked JS source must stay plain text.
//
// A raw NUL byte in a source file is legal JavaScript (it's just a character in
// a string literal) so node --check and the test suite stay green — but it flips
// the file to "binary" for every content search tool:
//
//   - GNU grep prints "Binary file server.js matches" and hides the line.
//   - ripgrep disables binary detection for an explicitly-named file, but ENABLES
//     it when walking a directory. So a repo-wide search silently stops at the
//     first NUL and reports nothing after it.
//
// server.js:4759 carried two literal NULs used as an impossible split sentinel
// (`SHIP_GH_TOKEN || '\0nope\0'`). They were written as raw bytes instead of \0
// escapes, which made repo-wide grep blind to the last ~2,600 lines of the file
// — the crons, ship gate and WhatsApp router. Escapes produce an identical
// string value with none of the tooling damage, so: always escape.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// git ls-files is the precise definition of "our source" — it already excludes
// node_modules, dist, data/atlas and every other gitignored copy of the tree.
function trackedSourceFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '*.js', '*.jsx', '*.mjs', '*.cjs'], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.toString('utf8').split('\0').filter(Boolean);
}

describe('tracked JS source', () => {
  it('contains no raw NUL bytes (use \\0 escapes — raw NULs blind repo-wide grep)', () => {
    const offenders = [];
    for (const rel of trackedSourceFiles()) {
      const buf = readFileSync(join(repoRoot, rel));
      const at = buf.indexOf(0);
      if (at === -1) continue;
      const line = buf.subarray(0, at).toString('utf8').split('\n').length;
      offenders.push(`${rel}:${line} (byte ${at})`);
    }
    expect(offenders).toEqual([]);
  });
});
