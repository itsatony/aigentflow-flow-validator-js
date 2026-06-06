// Conformance suite: each fixture is validated and compared against an
// expected verdict. Comparison is STRUCTURAL — the `valid` flag plus the set
// of expected error codes (a subset check) — never exact message text. This
// is the regression net that catches drift from the AIgentFlow reference.
//
// To extend: drop a new `.yaml` under fixtures/ and add an entry here.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateFlow } from '../../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');

interface Case {
  file: string;
  valid: boolean;
  /** Error codes that MUST be present (subset of the actual error codes). */
  expectErrorCodes?: string[];
  /** Warning codes that MUST be present. */
  expectWarningCodes?: string[];
}

const CASES: Case[] = [
  { file: 'valid-minimal.yaml', valid: true },
  { file: 'valid-branching.yaml', valid: true },
  {
    file: 'invalid-missing-fields.yaml',
    valid: false,
    expectErrorCodes: ['missing_required_field', 'step_not_found'],
  },
  {
    file: 'invalid-references-and-templates.yaml',
    valid: false,
    expectErrorCodes: [
      'invalid_executor_url',
      'template_syntax_error',
      'step_not_found',
      'invalid_error_strategy_action',
    ],
  },
];

describe('conformance fixtures', () => {
  for (const c of CASES) {
    it(`${c.file} → ${c.valid ? 'valid' : 'invalid'}`, () => {
      const yaml = readFileSync(join(fixturesDir, c.file), 'utf8');
      const result = validateFlow(yaml);
      const errorCodes = new Set(result.errors.map((e) => e.code));
      const warningCodes = new Set(result.warnings.map((w) => w.code));

      expect(result.valid, `errors: ${[...errorCodes].join(', ')}`).toBe(c.valid);
      if (c.valid) {
        expect(result.errors).toHaveLength(0);
      }
      for (const code of c.expectErrorCodes ?? []) {
        expect(errorCodes, `expected error code '${code}'`).toContain(code);
      }
      for (const code of c.expectWarningCodes ?? []) {
        expect(warningCodes, `expected warning code '${code}'`).toContain(code);
      }
    });
  }
});
