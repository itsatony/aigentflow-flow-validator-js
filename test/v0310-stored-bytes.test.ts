// 0.31.0 — `storedBytes`: the codes AIgentFlow tolerates when LOADING a stored flow
// (spec block `storedBytesTolerated`) are reported as warnings; nothing else changes.
// Mirrors storedbytes_test.go in go-aigentflow-validator.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';
import { STORED_BYTES_TOLERATED } from '../src/spec/index.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'conformance', 'fixtures');
const files = readdirSync(dir).filter((f) => f.endsWith('.yaml'));
const read = (f: string): string => readFileSync(join(dir, f), 'utf8');
const key = (i: { code: string; field: string; message: string }): string =>
  `${i.code}|${i.field}|${i.message}`;

describe('storedBytes', () => {
  it('demotes exactly the tolerated codes on every conformance fixture', () => {
    expect(files.length).toBeGreaterThan(200);
    const seen = new Set<string>();
    for (const f of files) {
      const save = validateFlow(read(f));
      const stored = validateFlow(read(f), { storedBytes: true });
      const demoted = save.errors.filter((e) => STORED_BYTES_TOLERATED.has(e.code));
      const kept = save.errors.filter((e) => !STORED_BYTES_TOLERATED.has(e.code));
      demoted.forEach((d) => seen.add(d.code));
      expect(
        stored.errors.map((e) => e.code),
        f,
      ).toEqual(kept.map((e) => e.code));
      expect(stored.valid, f).toBe(kept.length === 0);
      expect(stored.warnings.length, f).toBe(save.warnings.length + demoted.length);
      const warned = new Map<string, number>();
      stored.warnings.forEach((w) => warned.set(key(w), (warned.get(key(w)) ?? 0) + 1));
      for (const d of demoted) {
        expect(
          warned.get(key(d)) ?? 0,
          `${f}: ${d.code} lost its field or message`,
        ).toBeGreaterThan(0);
        warned.set(key(d), (warned.get(key(d)) ?? 0) - 1);
      }
      stored.warnings.forEach((w) => expect(w.severity, f).toBe('warning'));
      expect(stored.summary.errorCount, f).toBe(stored.errors.length);
      expect(stored.summary.warningCount, f).toBe(stored.warnings.length);
    }
    const missing = [...STORED_BYTES_TOLERATED].filter((c) => !seen.has(c));
    expect(missing, 'tolerated codes no fixture raises').toEqual([]);
  });

  it('a bare for_each.items is refused at save and loads with the warning when stored', () => {
    const src = read('invalid-for-each-items-bare-path.yaml');
    const save = validateFlow(src);
    expect(save.valid).toBe(false);
    const stored = validateFlow(src, { storedBytes: true });
    expect(stored.valid).toBe(true);
    expect(stored.warnings.map((w) => w.code)).toContain('for_each_items_unresolvable');
  });

  it('keeps an untolerated error an error', () => {
    const stored = validateFlow(read('invalid-flow-data-key-reserved-dot.yaml'), {
      storedBytes: true,
    });
    expect(stored.valid).toBe(false);
    expect(stored.errors.map((e) => e.code)).toContain('flow_data_key_reserved');
  });

  it('never masks a parse failure', () => {
    expect(validateFlow('name: [unterminated', { storedBytes: true }).valid).toBe(false);
  });
});
