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
  /**
   * Warning codes that must NOT be present.
   *
   * A rule whose entire risk is a FALSE POSITIVE cannot be expressed by `valid`
   * or by `expectWarningCodes`: a warning never changes the verdict, so an
   * all-correct fixture is green no matter how indiscriminately the rule fires.
   * This is the only assertion that can fail on over-firing.
   */
  forbidWarningCodes?: string[];
}

const CASES: Case[] = [
  { file: 'valid-minimal.yaml', valid: true },
  {
    // AIF DC-FORGE-146: a top-level `budget:` is never enforced — a hermetic
    // run with `budget: 0.000001` and $2 of spend completed — and a
    // `max_retries:` on the flow or directly on a step is never read by the
    // retry engine, which reads only `error_strategy.max_retries`.
    file: 'warn-unread-limits.yaml',
    valid: true,
    expectWarningCodes: ['flow_budget_unenforced', 'max_retries_unread'],
  },
  {
    // The counter-fixture. `error_strategy.max_retries` at flow AND step level
    // is the key the retry engine DOES read, and `billing.max_credits` is the
    // ceiling that IS enforced; neither may warn.
    file: 'valid-unread-limits-working-keys.yaml',
    valid: true,
    forbidWarningCodes: ['flow_budget_unenforced', 'max_retries_unread'],
  },
  {
    // v2.608.0: the ONE grammar key spelled `goto` (aigentflow.domain.step.go:134).
    // Reading `goto_step` here disabled every conditional-branch check in this
    // validator AND made every conditionally-reached step look unreachable.
    file: 'invalid-condition-goto-step-misspelling.yaml',
    valid: false,
    expectErrorCodes: ['unknown_yaml_key'],
  },
  {
    // v2.608.0 (DC-FORGE-30 + DC-FORGE-38): executor URLs are parsed with the ONE
    // parser at authoring time. Four shapes AIgentFlow refuses at SAVE — including
    // one inside a loop sub-step, which the Go side only started checking in
    // v2.608.0 and this validator has always checked.
    file: 'invalid-executor-url-shapes.yaml',
    valid: false,
    expectErrorCodes: ['invalid_executor_url'],
  },
  {
    // The `{{` exception is load-bearing in both implementations.
    file: 'valid-templated-executor-url.yaml',
    valid: true,
  },
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
    // v2.642.0 (DC-FORGE-72): the expression-function catalog is compiled in and
    // nothing is loaded at run time, so `package:` is refused outright.
    file: 'invalid-expression-function-package.yaml',
    valid: false,
    expectErrorCodes: ['expression_function_package_unsupported'],
  },
  {
    // v2.642.0: a `function:` outside the fixed catalog is refused.
    file: 'invalid-expression-function-unknown-name.yaml',
    valid: false,
    expectErrorCodes: ['expression_function_unknown'],
  },
  {
    // v2.642.0: a template may only call an `fn_` function the flow declares,
    // and a name that is not in the catalog at all gets its own verdict.
    file: 'invalid-expression-function-undeclared-use.yaml',
    valid: false,
    expectErrorCodes: ['expression_function_undeclared_use', 'expression_function_unknown_use'],
  },
  {
    // v2.642.0: declared and used, one of them inside a multi-line action.
    file: 'valid-expression-functions.yaml',
    valid: true,
  },
  {
    // v2.642.0: only the text between `{{` and `}}` is scanned — prose that
    // mentions an `fn_` name is not a call.
    file: 'valid-expression-function-prose-mention.yaml',
    valid: true,
  },
  {
    // v2.642.0 correction: a FIELD, a data KEY or a STEP whose name begins with
    // `fn_` is not a call. `\b` matches between the dot and the `f`, so the
    // first cut of this rule refused these valid flows.
    file: 'valid-expression-function-field-lookalikes.yaml',
    valid: true,
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
      for (const code of c.forbidWarningCodes ?? []) {
        expect(warningCodes, `warning code '${code}' must NOT be raised here`).not.toContain(code);
      }
    });
  }
});
