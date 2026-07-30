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
    // CLEANER POWER Phase 2: wait:// + eval:// schemes, output_schema, quality_gate.
    file: 'valid-wait-eval-schema-gate.yaml',
    valid: true,
  },
  {
    file: 'invalid-output-schema-and-quality-gate.yaml',
    valid: false,
    expectErrorCodes: [
      'input_schema_invalid_version',
      'input_schema_invalid_field_name',
      'quality_gate_missing_rubric',
      'quality_gate_threshold_out_of_range',
      'quality_gate_on_fail_unsupported',
    ],
  },
  {
    // Skope retired in v2.435.0 → skope:// is now an unknown scheme (warns, not rejects).
    file: 'valid-retired-skope-scheme-warns.yaml',
    valid: true,
    expectWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'invalid-missing-fields.yaml',
    valid: false,
    expectErrorCodes: ['missing_required_field', 'step_not_found'],
  },
  {
    // DC-COND-1: monitor-mode orchestrator over a self-terminating DAG is valid.
    file: 'valid-orchestrator-monitor.yaml',
    valid: true,
  },
  {
    // DC-COND-2: monitor-mode campaign with on_children_complete → a real step.
    file: 'valid-campaign-handoff.yaml',
    valid: true,
  },
  {
    // DC-COND-2: on_children_complete referencing a nonexistent step is refused.
    file: 'invalid-campaign-handoff-unknown-step.yaml',
    valid: false,
    expectErrorCodes: ['campaign_handoff_step_unknown'],
  },
  {
    // DC-COND-1: owner mode with no next: orchestrator yield edge is refused.
    file: 'invalid-orchestrator-owner-no-yield.yaml',
    valid: false,
    expectErrorCodes: ['orchestrator_owner_needs_yield'],
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
