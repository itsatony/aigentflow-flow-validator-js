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
   * Warning codes that must NOT be present. A rule whose whole risk is a false
   * positive needs a fixture that goes red when it fires, and "valid: true" does
   * not say that — a warning never changes the verdict.
   */
  forbidWarningCodes?: string[];
  /**
   * Error codes that must NOT be present on an otherwise-valid fixture.
   *
   * `valid: true` already fails on ANY spurious error, so this is not the
   * verdict-shaped hole `forbidWarningCodes` fills for warning rules. It NAMES
   * the rule under test, so a regression reads as "the loop-target rule fired on
   * a legal backward jump" rather than as an anonymous count mismatch.
   */
  forbidErrorCodes?: string[];
}

const CASES: Case[] = [
  { file: 'valid-minimal.yaml', valid: true },
  {
    // DC-FORGE-78: the loop body is a SECOND step table, and neither
    // implementation walked it until v2.648.0. ⛔ Every template in this fixture
    // is unparseable and the flow must still be VALID — the reference consults
    // this validator at its RUN door over flows stored before the walk existed,
    // and the "the run already died anyway" licence needs the failing path
    // UNCONDITIONAL, which inside a loop body it is not.
    file: 'valid-loop-body-templates-warn.yaml',
    valid: true,
    expectWarningCodes: ['template_syntax_error'],
  },
  {
    // ⚠️ The control, and it is the assertion that matters: a rule whose whole
    // risk is a false positive needs a fixture that goes red when it fires, and
    // `valid: true` cannot express that — a warning never changes the verdict.
    file: 'valid-loop-body-clean.yaml',
    valid: true,
    forbidWarningCodes: [
      'template_syntax_error',
      'template_function_unknown',
      'unknown_processing_operation',
      'unknown_processing_config_key',
    ],
  },
  {
    // The partition from the side that is easy to lose: `loop.set` is
    // dispatchable ONLY on a loop sub-step, so at the top level it is an
    // operation the standard handler has no case for. A union would accept it.
    file: 'valid-loop-only-op-at-top-level-warns.yaml',
    valid: true,
    expectWarningCodes: ['unknown_processing_operation'],
  },
  {
    // AIF v2.651.0 (DC-FORGE-81): `goto_step` is read ONLY when the same
    // strategy's action is `goto`. Beside any other action the engine never
    // looks at it and the handler is unreachable — which is what BOTH of AIF's
    // bundled example flows shipped. Both levels are checked independently, so
    // both are declared here.
    file: 'warn-unreachable-error-goto.yaml',
    valid: true,
    expectWarningCodes: ['unreachable_error_goto'],
  },
  {
    // The counter-fixture, and the one that matters: every goto_step here IS
    // reachable. Without forbidWarningCodes this file is green even if the rule
    // fires on every error_strategy it sees.
    file: 'valid-reachable-error-goto.yaml',
    valid: true,
    forbidWarningCodes: ['unreachable_error_goto'],
  },
  {
    // AIF v2.652.0 (DC-FORGE-82): a loop BODY is a second step table, and the
    // walk for unreachable_error_goto never entered it — the same blind spot the
    // reference had. Inside one, goto_step is unreachable under EVERY action, so
    // the remedy that fixes unreachable_error_goto (`action: goto`) is already
    // what this fixture says and changes nothing. Both codes are declared: the
    // new one must fire, and the older one must NOT, because following its
    // advice here is a dead end.
    file: 'warn-loop-substep-error-goto.yaml',
    valid: true,
    expectWarningCodes: ['loop_substep_error_goto_ignored'],
    forbidWarningCodes: ['unreachable_error_goto'],
  },
  {
    // The counter-fixture. The loop STEP's own error_strategy names a goto_step
    // beside `action: goto` — which is precisely where the warning's remedy
    // sends an author — so a rule that fired on any goto_step near a loop would
    // make its own advice warn.
    file: 'valid-loop-substep-error-continue.yaml',
    valid: true,
    forbidWarningCodes: ['loop_substep_error_goto_ignored', 'unreachable_error_goto'],
  },
  {
    // AIF v2.672.0 (DC-FORGE-102, aigentflow#116): a loop sub-step's next:
    // targets resolve ONLY against loop.steps of the SAME loop. Both jump
    // directions are legal and an empty target is the documented sequential
    // advance — this fixture exercises all three, and forbids the codes so an
    // over-firing rule cannot hide behind a rule that is merely silent.
    file: 'valid-loop-substep-next.yaml',
    valid: true,
    forbidErrorCodes: [
      'loop_substep_next_target_not_found',
      'loop_substep_next_sentinel',
      'loop_substep_next_parallel',
    ],
  },
  {
    // The interesting miss: the target names a real TOP-LEVEL step, which the
    // loop driver cannot see. Before the rule this saved clean and degraded to
    // a runtime WARN plus a silent sequential advance.
    file: 'invalid-loop-substep-next-unknown-target.yaml',
    valid: false,
    expectErrorCodes: ['loop_substep_next_target_not_found'],
  },
  {
    // The two top-level sentinels have no meaning in a loop body.
    file: 'invalid-loop-substep-next-sentinel.yaml',
    valid: false,
    expectErrorCodes: ['loop_substep_next_sentinel'],
  },
  {
    // The loop driver reads conditions/default only; a parallel block is inert.
    file: 'invalid-loop-substep-next-parallel.yaml',
    valid: false,
    expectErrorCodes: ['loop_substep_next_parallel'],
  },
  {
    // AIF DC-FORGE-145: `response_expectation` is read ONLY when
    // `response_evaluation` is set. Without one, required/type/fallback are
    // inert — the reference found 25 such steps in its own bundled flows.
    file: 'warn-response-expectation-unread.yaml',
    valid: true,
    expectWarningCodes: ['response_expectation_unread'],
  },
  {
    // The counter-fixtures. Each is a way the rule could over-fire: an
    // evaluation mode that DOES read the expectation, an async:// step whose
    // respond route enforces it on its own, and no (or an empty) expectation.
    file: 'valid-response-expectation-raw-text.yaml',
    valid: true,
    forbidWarningCodes: ['response_expectation_unread'],
  },
  {
    file: 'valid-response-expectation-async.yaml',
    valid: true,
    forbidWarningCodes: ['response_expectation_unread'],
  },
  {
    file: 'valid-response-expectation-absent.yaml',
    valid: true,
    forbidWarningCodes: ['response_expectation_unread'],
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
    // AIF v2.695.0 (DC-FORGE-125, aigentflow#124): the per-question HITL
    // deadline. A NEGATIVE duration is well-formed Go, so a bare
    // isValidGoDuration check accepts it and the reference parser does not —
    // an oracle looser than its door, in the damaging direction.
    file: 'invalid-orchestrator-human-question-timeout.yaml',
    valid: false,
    expectErrorCodes: ['orchestrator_human_question_timeout_invalid'],
  },
  {
    // The other side of the same rule: a declared deadline with its response is
    // legal.
    //
    // NOTE no `forbidErrorCodes` here, deliberately. `valid: true` already
    // fails on ANY error, so a rule that misfired on this fixture is caught
    // either way — unlike a WARNING rule, whose false positive leaves `valid`
    // untouched and needs the explicit forbid list. Adding the machinery for an
    // error rule would buy a nicer failure message and no coverage.
    file: 'valid-orchestrator-human-question-timeout.yaml',
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
    // A processing operation type the standard handler cannot dispatch: a
    // misspelling, and `loop.set`, which only a loop sub-step handles. Both are
    // warnings — the flow saves and runs, and fails at the operation.
    file: 'valid-processing-operation-unknown-type-warns.yaml',
    valid: true,
    expectWarningCodes: ['unknown_processing_operation'],
    // An unknown type has no key set, so its keys must not warn as well.
    forbidWarningCodes: ['unknown_processing_config_key'],
  },
  {
    // Config keys the handler never reads, including `asset_id` under
    // `binary.transform` — real for binary.get/update/delete, wrong here. A
    // union of the key sets across operations would accept it.
    file: 'valid-processing-config-key-wrong-half-warns.yaml',
    valid: true,
    expectWarningCodes: ['unknown_processing_config_key'],
  },
  {
    // The other half of the partition: closed key sets used correctly, and the
    // open-key operations whose keys are author-chosen names. Neither rule may
    // say anything here.
    file: 'valid-processing-config-keys-accepted.yaml',
    valid: true,
    forbidWarningCodes: ['unknown_processing_operation', 'unknown_processing_config_key'],
  },
  {
    // AIF v2.721.0 (DC-FORGE-150): the flow-level `budget:` was deleted from the
    // grammar — nothing read it. The save door refuses it, `0` included.
    file: 'invalid-retired-flow-budget.yaml',
    valid: false,
    expectErrorCodes: ['unknown_yaml_key'],
  },
  {
    // v2.721.0: the flow-level `max_retries:` was deleted too.
    file: 'invalid-retired-flow-max-retries.yaml',
    valid: false,
    expectErrorCodes: ['unknown_yaml_key'],
  },
  {
    // v2.721.0: and so was a `max_retries:` directly on a step.
    file: 'invalid-retired-step-max-retries.yaml',
    valid: false,
    expectErrorCodes: ['unknown_yaml_key'],
  },
  {
    // The false positive to guard: the WORKING keys one level down —
    // error_strategy.max_retries (flow + step), quality_gate.max_retries,
    // billing.max_credits — and the surviving currency / max_duration. An
    // ERROR rule changes the verdict, so `valid: true` (zero errors) is the proof.
    file: 'valid-limit-keys-one-level-down.yaml',
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
  {
    // AIF DC-FORGE-147: the engine bounds each executor invocation by the
    // step's max_duration. An unparseable value ("2d", "5 minutes", a template)
    // bounds nothing, and neither does one on a loop step.
    file: 'warn-step-max-duration-ignored.yaml',
    valid: true,
    expectWarningCodes: ['step_max_duration_ignored'],
  },
  {
    // The counter-fixture: Go durations (incl. compound), the three no-bound
    // spellings, and a bounded step beside a loop step with no max_duration.
    file: 'valid-step-max-duration-applied.yaml',
    valid: true,
    forbidWarningCodes: ['step_max_duration_ignored'],
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
        expect(
          warningCodes,
          `unexpected warning code '${code}': ${result.warnings
            .filter((w) => w.code === code)
            .map((w) => `${w.field}: ${w.message}`)
            .join(' | ')}`,
        ).not.toContain(code);
      }
      for (const code of c.forbidErrorCodes ?? []) {
        expect(errorCodes, `error code '${code}' must NOT be raised here`).not.toContain(code);
      }
    });
  }
});
