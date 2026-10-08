// The table the shared `examples-*` fixtures carry: for every fixture, the finding it
// must raise (code, field and, where the reference states it, the exact message), or
// none at all. The conformance suite asserts the verdict and the code; this one pins the
// field path and the wording as well, which is what a host application shows an author.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'conformance/fixtures');

interface SharedCase {
  file: string;
  code: string | null;
  field: string;
  message: string | null;
  clean: boolean;
}

// The reference refuses this one on a regular-expression syntax error, which this
// validator does not judge (PARITY.md, divergence #21).
const LOOSER_HERE = new Set(['examples-invalid-example-matcher-bad-regex.yaml']);

describe('examples: the shared (code, field, message) table', () => {
  const cases = JSON.parse(
    readFileSync(join(here, 'conformance/examples-cases.json'), 'utf8'),
  ) as SharedCase[];

  it('names every examples fixture on disk, once', () => {
    const onDisk = readdirSync(fixturesDir).filter(
      (f) => f.startsWith('examples-') && f.endsWith('.yaml'),
    );
    expect(cases.map((c) => c.file).sort()).toEqual(onDisk.sort());
  });

  for (const c of cases) {
    it(c.file, () => {
      const r = validateFlow(readFileSync(join(fixturesDir, c.file), 'utf8'));
      const found = [...r.errors, ...r.warnings].filter((i) => /^examples?_/.test(i.code));
      if (c.clean || c.code === null) {
        expect(found).toEqual([]);
        return;
      }
      const hit = found.find((i) => i.code === c.code && i.field === c.field);
      if (LOOSER_HERE.has(c.file)) {
        expect(hit).toBeUndefined();
        return;
      }
      expect(
        hit,
        `${c.code} at ${c.field}; found ${found.map((i) => `${i.code}@${i.field}`).join(', ')}`,
      ).toBeDefined();
      if (c.message !== null) expect(hit?.message).toBe(c.message);
    });
  }
});
