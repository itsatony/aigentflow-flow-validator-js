// Conformance suite: each fixture is validated and compared against an
// expected verdict. Comparison is STRUCTURAL — the `valid` flag plus the set
// of expected error codes (a subset check) — never exact message text. This
// is the regression net that catches drift from the AIgentFlow reference.
//
// To extend: drop a new `.yaml` under fixtures/ and add an entry here.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateFlow } from '../../src/index.js';
import { EXAMPLES } from '../../src/spec/index.js';

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
  /**
   * The fixture's reference verdict needs an `.exons` ENGINE (PARITY.md,
   * divergence #16), which this validator does not have. `valid` and
   * `expectErrorCodes` state the REFERENCE's verdict, for the record and for
   * any implementation that has an engine; this suite asserts the documented,
   * looser one instead: valid, with none of `expectErrorCodes`.
   */
  exonsEngineOnly?: boolean;
  /**
   * The reference refuses this fixture and this validator deliberately does not
   * (a documented, looser divergence in PARITY.md). `valid` and
   * `expectErrorCodes` state the REFERENCE's verdict; this suite asserts the
   * looser one: valid, with none of `expectErrorCodes`.
   */
  looserHere?: boolean;
}

// Every warning of the `examples:` block, from the spec: the all-correct flows must raise none of them.
const EXAMPLE_WARNING_CODES = Object.entries(EXAMPLES.codes)
  .filter(([, severity]) => severity === 'warning')
  .map(([code]) => code);

// The codes of the orchestrator rules that left with the orchestrator
// (AIgentFlow v2.838.0). A fixture that forbids them goes red if any of them
// ever judges a refused block again.
const RETIRED_ORCHESTRATOR_RULE_CODES = [
  'orchestrator_exons_required',
  'orchestrator_mode_invalid',
  'orchestrator_owner_needs_yield',
  'orchestrator_trigger_unknown',
  'orchestrator_timer_no_interval',
  'orchestrator_timer_bad_interval',
  'orchestrator_tool_unknown',
  'orchestrator_not_agentic',
  'orchestrator_human_question_timeout_invalid',
  'orchestrator_enforce_region_needs_region',
  'orchestrator_exons_parse_failed',
  'orchestrator_exons_no_provider',
  'exons_resources_unhonoured',
  'exons_attributes',
  'orchestrator_tool_withheld',
  'tool_discovery_invalid',
  'orchestrator_next_requires_orchestrator',
];

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
    // here:// is a known scheme. A rule whose risk is a false positive: a warning
    // never changes the verdict, so the code is forbidden by name.
    file: 'valid-executor-here.yaml',
    valid: true,
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'valid-strict-templates.yaml',
    valid: true,
    forbidErrorCodes: ['unknown_yaml_key', 'invalid_type', 'template_default_piped'],
    forbidWarningCodes: ['template_default_piped'],
  },
  {
    file: 'invalid-strict-templates-type.yaml',
    valid: false,
    expectErrorCodes: ['invalid_type'],
  },
  {
    // `default` is value first; every spelling of a pipe into it is an error.
    file: 'invalid-template-default-piped.yaml',
    valid: false,
    expectErrorCodes: ['template_default_piped'],
  },
  {
    // Positional, like template_syntax_error: inside a loop body it warns.
    file: 'warn-template-default-piped-loop.yaml',
    valid: true,
    expectWarningCodes: ['template_default_piped'],
    forbidErrorCodes: ['template_default_piped'],
  },
  {
    // The control: shapes that merely contain the word, or call it correctly.
    file: 'valid-template-default-clean.yaml',
    valid: true,
    forbidErrorCodes: ['template_default_piped'],
    forbidWarningCodes: ['template_default_piped', 'template_syntax_error'],
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
    // AIF v2.648.0 (DC-FORGE-78): a sub-step id that is also a loop-result
    // summary field. A warning — the verdict stays valid.
    file: 'warn-loop-sub-step-id-reserved.yaml',
    valid: true,
    expectWarningCodes: ['loop_sub_step_id_reserved'],
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
  // Reference save-door refusals first carried by the Go port. Each invalid
  // fixture was checked against the reference's strict save parser, AND a copy
  // with only the offending value corrected was checked to SAVE — so the
  // refusal is the rule under test and nothing else.
  {
    file: 'invalid-reserved-step-id-orchestrator.yaml',
    valid: false,
    expectErrorCodes: ['reserved_step_id_orchestrator'],
  },
  {
    file: 'invalid-mock-scenario-delay.yaml',
    valid: false,
    expectErrorCodes: ['mock_delay_invalid'],
  },
  {
    // A bare 0, compound, '.5s', '1.s', a sign, the micro sign, empty and null.
    file: 'valid-mock-scenario-delay.yaml',
    valid: true,
    forbidErrorCodes: ['mock_delay_invalid'],
  },
  {
    file: 'invalid-output-param-empty.yaml',
    valid: false,
    expectErrorCodes: ['output_param_empty'],
  },
  {
    // yaml.v3 drops a null list entry, so the reference saves this.
    file: 'valid-output-null-entry.yaml',
    valid: true,
    forbidErrorCodes: ['output_param_empty'],
  },
  {
    // 0.14.0: `end` is looked up as a STEP by the reference's save door
    // (validateNextLogic accepts only null / orchestrator without one). Both a
    // default and a condition's goto route to it here, and no step is `end`.
    file: 'invalid-next-end-without-step.yaml',
    valid: false,
    expectErrorCodes: ['step_not_found'],
  },
  {
    // A real step named `end` saves and is REACHABLE: since AIgentFlow v2.760.0
    // no reference walk treats `end` as a terminal (it was unreachable until 0.15.0).
    file: 'valid-next-end-names-a-step.yaml',
    valid: true,
    forbidWarningCodes: ['unreachable_step'],
    forbidErrorCodes: ['step_not_found'],
  },
  {
    // KnownFields(true) at every depth: root, step, error_strategy, next, a
    // query parameter definition and a mock scenario step. Seven keys, seven
    // findings (the unit test pins the fields).
    file: 'invalid-unknown-keys.yaml',
    valid: false,
    expectErrorCodes: ['unknown_yaml_key'],
  },
  {
    // `next: end` is a scalar where a mapping is required; `tags:` must be a list.
    file: 'invalid-value-kind.yaml',
    valid: false,
    expectErrorCodes: ['invalid_type'],
  },
  {
    // ⚠️ The false-positive guard for the unknown-key rule: author-chosen maps,
    // interfaces, inlined constraint keys, nulls, a merge key, a numeric step id.
    file: 'valid-open-key-sets.yaml',
    valid: true,
    forbidErrorCodes: ['unknown_yaml_key', 'invalid_type'],
    // `default: 1` reaches the step `1`: a number in a step reference is the
    // step id of its text (0.14.1).
    forbidWarningCodes: ['unreachable_step'],
  },
  {
    // A number in a Go `string` duration field is its SOURCE text: 0.0, 00, 0x0,
    // 100 and 1.5 have no unit. Mock delay, throttle delay / batch_delay, max_delay.
    file: 'invalid-duration-numeric-spellings.yaml',
    valid: false,
    expectErrorCodes: ['mock_delay_invalid', 'invalid_duration'],
  },
  {
    // The numbers that DO save there: 0, +0, -0.
    file: 'valid-duration-numeric-zero.yaml',
    valid: true,
    forbidErrorCodes: ['mock_delay_invalid', 'invalid_duration'],
  },
  // 0.14.1: a step REFERENCE written as a number is the step id of its source
  // text, because the reference decodes every reference into a Go `string`.
  // Each pair is one reference kind, refused and accepted; every verdict was
  // measured on the reference's strict save parser (by the Go port, v0.5.1).
  {
    file: 'invalid-numeric-next-default-unknown.yaml',
    valid: false,
    expectErrorCodes: ['step_not_found'],
  },
  {
    file: 'valid-numeric-next-default.yaml',
    valid: true,
    forbidWarningCodes: ['unreachable_step'],
  },
  {
    file: 'invalid-numeric-condition-goto-unknown.yaml',
    valid: false,
    expectErrorCodes: ['step_not_found'],
  },
  {
    file: 'valid-numeric-condition-goto.yaml',
    valid: true,
    forbidWarningCodes: ['unreachable_step'],
  },
  {
    file: 'invalid-numeric-parallel-member-unknown.yaml',
    valid: false,
    expectErrorCodes: ['step_not_found'],
  },
  {
    // A false step_not_found on the member and a false missing rendezvous.
    file: 'valid-numeric-parallel-member.yaml',
    valid: true,
    forbidErrorCodes: ['step_not_found', 'missing_required_field'],
    forbidWarningCodes: ['unreachable_step'],
  },
  {
    // Refused as a MISSING STEP — the goto_step is present.
    file: 'invalid-numeric-error-goto-unknown.yaml',
    valid: false,
    expectErrorCodes: ['step_not_found'],
    forbidErrorCodes: ['goto_step_missing'],
  },
  {
    file: 'valid-numeric-error-goto.yaml',
    valid: true,
    forbidErrorCodes: ['goto_step_missing'],
    forbidWarningCodes: ['unreachable_step'],
  },
  {
    // `1e3`, `0x1F` and `True`, as keys and as references, are their text.
    file: 'valid-numeric-reference-spellings.yaml',
    valid: true,
    forbidWarningCodes: ['unreachable_step'],
  },
  {
    // `1e3` is not the step `1000`, although both are the number 1000.
    file: 'invalid-numeric-reference-spelling-mismatch.yaml',
    valid: false,
    expectErrorCodes: ['step_not_found'],
  },

  // 0.15.0 — the save-door rules AIgentFlow added after v2.753.0 (Go port v0.6.0).
  {
    // v2.597.0: five out-of-scope references, one per shape.
    file: 'invalid-executor-config-env-scope.yaml',
    valid: false,
    expectErrorCodes: ['executor_config_env_scope'],
  },
  {
    // The counter-fixture: every reference in scope, and every non-reference.
    file: 'valid-executor-config-env-scope.yaml',
    valid: true,
    forbidErrorCodes: ['executor_config_env_scope'],
  },
  // The agent surfaces AIgentFlow removed (spec 2.833.0).
  {
    file: 'invalid-executor-removed-exons.yaml',
    valid: false,
    expectErrorCodes: ['executor_removed'],
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'invalid-executor-removed-agent.yaml',
    valid: false,
    expectErrorCodes: ['executor_removed'],
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'invalid-executor-removed-scheme-case-whitespace.yaml',
    valid: false,
    expectErrorCodes: ['executor_removed'],
    forbidErrorCodes: ['invalid_executor_url'],
  },
  {
    file: 'invalid-executor-removed-loop-substep.yaml',
    valid: false,
    expectErrorCodes: ['executor_removed'],
  },
  {
    file: 'invalid-executor-removed-exons-uploads.yaml',
    valid: false,
    expectErrorCodes: ['executor_removed'],
    forbidErrorCodes: ['unknown_yaml_key'],
  },
  {
    file: 'invalid-agentic-param-removed.yaml',
    valid: false,
    expectErrorCodes: ['agentic_param_removed'],
  },
  {
    file: 'invalid-agentic-param-removed-false.yaml',
    valid: false,
    expectErrorCodes: ['agentic_param_removed'],
  },
  {
    file: 'invalid-agentic-param-removed-null-value.yaml',
    valid: false,
    expectErrorCodes: ['agentic_param_removed'],
  },
  {
    file: 'invalid-agentic-param-removed-loop-substep.yaml',
    valid: false,
    expectErrorCodes: ['agentic_param_removed'],
  },
  {
    // No false positive: aiv://, atlas://, a templated executor, a non-ai scheme
    // and chat-only ai:// parameters.
    file: 'valid-removed-surfaces-not-refused.yaml',
    valid: true,
    forbidErrorCodes: ['executor_removed', 'agentic_param_removed'],
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    // v2.760.0: `end` is a step, so this is a cycle, and `end` is reachable.
    file: 'warn-next-end-cycle.yaml',
    valid: true,
    expectWarningCodes: ['potential_infinite_loop'],
    forbidWarningCodes: ['unreachable_step'],
  },
  // A cycle is a potential infinite loop only when control cannot leave it. The
  // valid fixtures forbid the warning (valid: true cannot express a false
  // positive); the warn fixtures must keep it.
  {
    file: 'valid-cycle-ask-again-exit.yaml',
    valid: true,
    forbidWarningCodes: ['potential_infinite_loop'],
  },
  {
    file: 'valid-cycle-self-loop-exit.yaml',
    valid: true,
    forbidWarningCodes: ['potential_infinite_loop'],
  },
  {
    file: 'valid-cycle-condition-null.yaml',
    valid: true,
    forbidWarningCodes: ['potential_infinite_loop'],
  },
  {
    file: 'valid-cycle-no-default-ends.yaml',
    valid: true,
    forbidWarningCodes: ['potential_infinite_loop'],
  },
  {
    file: 'valid-cycle-contains-step-without-next.yaml',
    valid: true,
    forbidWarningCodes: ['potential_infinite_loop'],
  },
  {
    file: 'valid-cycle-parallel-exit.yaml',
    valid: true,
    forbidWarningCodes: ['potential_infinite_loop'],
  },
  {
    file: 'valid-cycle-unreachable-not-reported.yaml',
    valid: true,
    forbidWarningCodes: ['potential_infinite_loop'],
  },
  {
    file: 'warn-cycle-two-steps-no-exit.yaml',
    valid: true,
    expectWarningCodes: ['potential_infinite_loop'],
  },
  {
    file: 'warn-cycle-self-loop-no-exit.yaml',
    valid: true,
    expectWarningCodes: ['potential_infinite_loop'],
  },
  {
    file: 'warn-cycle-after-exiting-cycle.yaml',
    valid: true,
    expectWarningCodes: ['potential_infinite_loop'],
  },
  // 0.15.1 (AIgentFlow CFX-05): a step or loop sub-step query may not declare
  // a server-owned parameter. One fixture per key per surface, so dropping a key
  // from the spec set, or either surface from the scan, goes red here.
  {
    file: 'invalid-server-owned-query-key-api-key.yaml',
    valid: false,
    expectErrorCodes: ['server_owned_query_key'],
  },
  {
    file: 'invalid-server-owned-query-key-base-url.yaml',
    valid: false,
    expectErrorCodes: ['server_owned_query_key'],
  },
  {
    file: 'invalid-server-owned-query-key-delegation.yaml',
    valid: false,
    expectErrorCodes: ['server_owned_query_key'],
  },
  {
    file: 'invalid-server-owned-query-key-loop-api-key.yaml',
    valid: false,
    expectErrorCodes: ['server_owned_query_key'],
  },
  {
    file: 'invalid-server-owned-query-key-loop-base-url.yaml',
    valid: false,
    expectErrorCodes: ['server_owned_query_key'],
  },
  {
    file: 'invalid-server-owned-query-key-loop-delegation.yaml',
    valid: false,
    expectErrorCodes: ['server_owned_query_key'],
  },
  {
    // The counter-fixture: similar names, another case, a nested key, the name
    // as a value, and a flow input parameter of that name all save.
    file: 'valid-server-owned-query-key-lookalikes.yaml',
    valid: true,
    forbidErrorCodes: ['server_owned_query_key'],
  },
  // 0.22.0: a top-level data: key naming engine state is refused (flow_data_key_reserved).
  {
    file: 'invalid-flow-data-key-reserved-org-id.yaml',
    valid: false,
    expectErrorCodes: ['flow_data_key_reserved'],
  },
  {
    file: 'invalid-flow-data-key-reserved-memory.yaml',
    valid: false,
    expectErrorCodes: ['flow_data_key_reserved'],
  },
  {
    file: 'invalid-flow-data-key-reserved-underscore.yaml',
    valid: false,
    expectErrorCodes: ['flow_data_key_reserved'],
  },
  {
    file: 'invalid-flow-data-key-reserved-dot.yaml',
    valid: false,
    expectErrorCodes: ['flow_data_key_reserved'],
  },
  {
    file: 'invalid-flow-data-key-reserved-memory-prefix.yaml',
    valid: false,
    expectErrorCodes: ['flow_data_key_reserved'],
  },
  {
    file: 'invalid-flow-data-key-reserved-orchestrator-prefix.yaml',
    valid: false,
    expectErrorCodes: ['flow_data_key_reserved'],
  },
  {
    file: 'invalid-flow-data-key-reserved-campaign-prefix.yaml',
    valid: false,
    expectErrorCodes: ['flow_data_key_reserved'],
  },
  {
    file: 'invalid-flow-data-key-reserved-voiceagent-prefix.yaml',
    valid: false,
    expectErrorCodes: ['flow_data_key_reserved'],
  },
  {
    file: 'invalid-flow-data-key-reserved-current-flow.yaml',
    valid: false,
    expectErrorCodes: ['flow_data_key_reserved'],
  },
  {
    file: 'valid-flow-data-key-lookalikes.yaml',
    valid: true,
    forbidErrorCodes: ['flow_data_key_reserved'],
  },
  // 0.23.0: a function:// operation outside the built-in set is refused (unknown_function_operation).
  {
    file: 'invalid-function-operation-unknown.yaml',
    valid: false,
    expectErrorCodes: ['unknown_function_operation'],
  },
  {
    file: 'invalid-function-operation-unknown-loop-substep.yaml',
    valid: false,
    expectErrorCodes: ['unknown_function_operation'],
  },
  {
    file: 'valid-function-operation-builtins.yaml',
    valid: true,
    forbidErrorCodes: ['unknown_function_operation'],
  },
  {
    file: 'valid-function-operation-templated.yaml',
    valid: true,
    forbidErrorCodes: ['unknown_function_operation'],
  },
  // 0.25.0: the atlas:// executor scheme and its seven rules.
  {
    file: 'invalid-atlas-operation-unknown.yaml',
    valid: false,
    expectErrorCodes: ['atlas_operation_unknown'],
  },
  {
    file: 'invalid-atlas-operation-agent-resource.yaml',
    valid: false,
    expectErrorCodes: ['atlas_operation_unknown'],
  },
  {
    file: 'invalid-atlas-agent-missing.yaml',
    valid: false,
    expectErrorCodes: ['atlas_agent_missing'],
  },
  {
    file: 'invalid-atlas-agent-not-literal.yaml',
    valid: false,
    expectErrorCodes: ['atlas_agent_not_literal'],
  },
  {
    file: 'invalid-atlas-capabilities-not-literal.yaml',
    valid: false,
    expectErrorCodes: ['atlas_capabilities_not_literal'],
  },
  {
    file: 'invalid-atlas-prompt-missing.yaml',
    valid: false,
    expectErrorCodes: ['atlas_prompt_missing'],
  },
  { file: 'invalid-atlas-prompt-both.yaml', valid: false, expectErrorCodes: ['atlas_prompt_both'] },
  {
    file: 'invalid-atlas-capability-ref-invalid.yaml',
    valid: false,
    expectErrorCodes: ['atlas_capability_ref_invalid'],
  },
  {
    file: 'valid-atlas-agent-run-prompt.yaml',
    valid: true,
    forbidErrorCodes: [
      'atlas_agent_missing',
      'atlas_agent_not_literal',
      'atlas_capabilities_not_literal',
      'atlas_capability_ref_invalid',
      'atlas_operation_unknown',
      'atlas_prompt_both',
      'atlas_prompt_missing',
    ],
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'valid-atlas-agent-run-prompt-template.yaml',
    valid: true,
    forbidErrorCodes: [
      'atlas_agent_missing',
      'atlas_agent_not_literal',
      'atlas_capabilities_not_literal',
      'atlas_capability_ref_invalid',
      'atlas_operation_unknown',
      'atlas_prompt_both',
      'atlas_prompt_missing',
    ],
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'valid-atlas-capability-call.yaml',
    valid: true,
    forbidErrorCodes: [
      'atlas_agent_missing',
      'atlas_agent_not_literal',
      'atlas_capabilities_not_literal',
      'atlas_capability_ref_invalid',
      'atlas_operation_unknown',
      'atlas_prompt_both',
      'atlas_prompt_missing',
    ],
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'valid-atlas-templated-values.yaml',
    valid: true,
    forbidErrorCodes: [
      'atlas_agent_missing',
      'atlas_agent_not_literal',
      'atlas_capabilities_not_literal',
      'atlas_capability_ref_invalid',
      'atlas_operation_unknown',
      'atlas_prompt_both',
      'atlas_prompt_missing',
    ],
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'valid-atlas-capability-args-templated.yaml',
    valid: true,
    forbidErrorCodes: [
      'atlas_agent_missing',
      'atlas_agent_not_literal',
      'atlas_capabilities_not_literal',
      'atlas_capability_ref_invalid',
      'atlas_operation_unknown',
      'atlas_prompt_both',
      'atlas_prompt_missing',
    ],
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  // 0.26.0: three new rules and the alignments with the reference.
  {
    file: 'invalid-reserved-input-query.yaml',
    valid: false,
    expectErrorCodes: ['reserved_input_name'],
  },
  {
    file: 'invalid-reserved-input-schema.yaml',
    valid: false,
    expectErrorCodes: ['reserved_input_name'],
  },
  {
    file: 'invalid-atlas-model-not-literal.yaml',
    valid: false,
    expectErrorCodes: ['atlas_model_not_literal'],
  },
  {
    file: 'invalid-atlas-param-refused.yaml',
    valid: false,
    expectErrorCodes: ['atlas_param_refused'],
  },
  {
    file: 'invalid-atlas-param-refused-capability.yaml',
    valid: false,
    expectErrorCodes: ['atlas_param_refused'],
  },
  {
    file: 'invalid-atlas-agent-not-a-string.yaml',
    valid: false,
    expectErrorCodes: ['atlas_agent_missing'],
  },
  {
    file: 'invalid-atlas-prompt-blank.yaml',
    valid: false,
    expectErrorCodes: ['atlas_prompt_missing'],
  },
  {
    file: 'invalid-atlas-capabilities-nested-template.yaml',
    valid: false,
    expectErrorCodes: ['atlas_capabilities_not_literal'],
  },
  {
    file: 'invalid-atlas-capability-ref-dot.yaml',
    valid: false,
    expectErrorCodes: ['atlas_capability_ref_invalid'],
  },
  {
    file: 'valid-reserved-input-names-ok.yaml',
    valid: true,
    forbidErrorCodes: [
      'atlas_agent_missing',
      'atlas_agent_not_literal',
      'atlas_capabilities_not_literal',
      'atlas_capability_ref_invalid',
      'atlas_model_not_literal',
      'atlas_operation_unknown',
      'atlas_param_refused',
      'atlas_prompt_both',
      'atlas_prompt_missing',
      'reserved_input_name',
    ],
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'valid-atlas-model-literal.yaml',
    valid: true,
    forbidErrorCodes: [
      'atlas_agent_missing',
      'atlas_agent_not_literal',
      'atlas_capabilities_not_literal',
      'atlas_capability_ref_invalid',
      'atlas_model_not_literal',
      'atlas_operation_unknown',
      'atlas_param_refused',
      'atlas_prompt_both',
      'atlas_prompt_missing',
      'reserved_input_name',
    ],
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'valid-atlas-capability-url-arg.yaml',
    valid: true,
    forbidErrorCodes: [
      'atlas_agent_missing',
      'atlas_agent_not_literal',
      'atlas_capabilities_not_literal',
      'atlas_capability_ref_invalid',
      'atlas_model_not_literal',
      'atlas_operation_unknown',
      'atlas_param_refused',
      'atlas_prompt_both',
      'atlas_prompt_missing',
      'reserved_input_name',
    ],
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'valid-atlas-prompt-empty-with-template.yaml',
    valid: true,
    forbidErrorCodes: [
      'atlas_agent_missing',
      'atlas_agent_not_literal',
      'atlas_capabilities_not_literal',
      'atlas_capability_ref_invalid',
      'atlas_model_not_literal',
      'atlas_operation_unknown',
      'atlas_param_refused',
      'atlas_prompt_both',
      'atlas_prompt_missing',
      'reserved_input_name',
    ],
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  // 0.15.2 (AIgentFlow DC-FORGE-231 / DC-FORGE-233): an endpoint a
  // server-supplied credential will never be sent to. A WARNING, so each warn-*
  // fixture is valid, and the counter-fixtures FORBID the code: the whole risk
  // of a warning is a false positive, which `valid: true` cannot see. The exact
  // fields per fixture are pinned in test/v0152-credential-endpoint.test.ts.
  {
    file: 'warn-credential-endpoint-ai-step-query.yaml',
    valid: true,
    expectWarningCodes: ['credential_endpoint_unpaired'],
  },
  {
    file: 'warn-credential-endpoint-ai-loop-sub-step.yaml',
    valid: true,
    expectWarningCodes: ['credential_endpoint_unpaired'],
  },
  {
    file: 'warn-credential-endpoint-ai-executor-config.yaml',
    valid: true,
    expectWarningCodes: ['credential_endpoint_unpaired'],
  },
  {
    file: 'warn-credential-endpoint-family-step-query.yaml',
    valid: true,
    expectWarningCodes: ['credential_endpoint_unpaired'],
  },
  {
    file: 'warn-credential-endpoint-family-executor-config.yaml',
    valid: true,
    expectWarningCodes: ['credential_endpoint_unpaired'],
  },
  {
    // The author's own key beside the author's own URL, on every arm.
    file: 'valid-credential-endpoint-own-key-own-url.yaml',
    valid: true,
    forbidWarningCodes: ['credential_endpoint_unpaired'],
  },
  {
    // A server key beside the default endpoint (by origin), a deployment variable, a template, or no endpoint.
    file: 'valid-credential-endpoint-server-endpoints.yaml',
    valid: true,
    forbidWarningCodes: ['credential_endpoint_unpaired'],
  },
  {
    // ollama and vllm are exempt.
    file: 'valid-credential-endpoint-keyless-providers.yaml',
    valid: true,
    forbidWarningCodes: ['credential_endpoint_unpaired'],
  },
  {
    // Implicit-credential and non-expanding families, no credential, another family's variable, a non-string endpoint, a non-ai step, a non-provider executor_config key.
    file: 'valid-credential-endpoint-not-judged.yaml',
    valid: true,
    forbidWarningCodes: ['credential_endpoint_unpaired'],
  },
  { file: 'valid-display-name.yaml', valid: true, forbidErrorCodes: ['display_name_too_long'] },
  // 0.16.0: AIgentFlow v2.811.0's untrusted-input marker keys.
  { file: 'valid-untrusted-inputs.yaml', valid: true, forbidErrorCodes: ['unknown_yaml_key'] },
  { file: 'invalid-untrusted-misspelt.yaml', valid: false, expectErrorCodes: ['unknown_yaml_key'] },
  {
    // 80 code points but 82 UTF-16 units: the limit counts code points.
    file: 'valid-display-name-80-code-points.yaml',
    valid: true,
    forbidErrorCodes: ['display_name_too_long'],
  },
  {
    file: 'valid-display-name-80-runes.yaml',
    valid: true,
    forbidErrorCodes: ['display_name_too_long'],
  },
  {
    file: 'valid-display-name-80-runes-multibyte.yaml',
    valid: true,
    forbidErrorCodes: ['display_name_too_long'],
  },
  {
    file: 'invalid-display-name-81-runes.yaml',
    valid: false,
    expectErrorCodes: ['display_name_too_long'],
  },
  {
    file: 'invalid-display-name-81-runes-multibyte.yaml',
    valid: false,
    expectErrorCodes: ['display_name_too_long'],
  },
  {
    // The removed AigentChat scheme is an ordinary unknown scheme: a warning, and
    // no credential/endpoint judgement. (nexus:// is the agent runtime executor
    // again since AIgentFlow v2.835.0.)
    file: 'warn-removed-executor-aigentchat.yaml',
    valid: true,
    expectWarningCodes: ['unknown_executor_scheme'],
    forbidWarningCodes: ['credential_endpoint_unpaired'],
  },
  {
    file: 'invalid-display-name-81.yaml',
    valid: false,
    expectErrorCodes: ['display_name_too_long'],
  },
  {
    file: 'examples-invalid-examples-too-many.yaml',
    valid: false,
    expectErrorCodes: ['examples_too_many'],
  },
  {
    file: 'examples-invalid-examples-block-too-large.yaml',
    valid: false,
    expectErrorCodes: ['examples_block_too_large'],
  },
  {
    file: 'examples-invalid-example-id-missing.yaml',
    valid: false,
    expectErrorCodes: ['example_id_missing'],
  },
  {
    file: 'examples-invalid-example-id-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_id_invalid'],
  },
  {
    file: 'examples-invalid-example-id-slash.yaml',
    valid: false,
    expectErrorCodes: ['example_id_invalid'],
  },
  {
    file: 'examples-invalid-example-id-duplicate.yaml',
    valid: false,
    expectErrorCodes: ['example_id_duplicate'],
  },
  {
    file: 'examples-invalid-example-title-missing.yaml',
    valid: false,
    expectErrorCodes: ['example_title_missing'],
  },
  {
    file: 'examples-invalid-example-title-too-long.yaml',
    valid: false,
    expectErrorCodes: ['example_title_too_long'],
  },
  {
    file: 'examples-invalid-example-guidance-too-long.yaml',
    valid: false,
    expectErrorCodes: ['example_guidance_too_long'],
  },
  {
    file: 'examples-warn-example-guidance-missing.yaml',
    valid: true,
    expectWarningCodes: ['example_guidance_missing'],
  },
  {
    file: 'examples-invalid-example-notes-too-long.yaml',
    valid: false,
    expectErrorCodes: ['example_notes_too_long'],
  },
  {
    file: 'examples-invalid-example-tag-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_tag_invalid'],
  },
  {
    file: 'examples-invalid-example-tag-duplicate.yaml',
    valid: false,
    expectErrorCodes: ['example_tag_invalid'],
  },
  {
    file: 'examples-invalid-example-tags-too-many.yaml',
    valid: false,
    expectErrorCodes: ['example_tag_invalid'],
  },
  {
    file: 'examples-invalid-example-weight-range.yaml',
    valid: false,
    expectErrorCodes: ['example_weight_range'],
  },
  {
    file: 'examples-invalid-example-weight-too-big.yaml',
    valid: false,
    expectErrorCodes: ['example_weight_range'],
  },
  {
    file: 'examples-invalid-example-holdout-in-public-flow.yaml',
    valid: false,
    expectErrorCodes: ['example_holdout_in_public_flow'],
  },
  {
    file: 'examples-invalid-example-input-conflict.yaml',
    valid: false,
    expectErrorCodes: ['example_input_conflict'],
  },
  {
    file: 'examples-invalid-example-input-missing.yaml',
    valid: false,
    expectErrorCodes: ['example_input_missing'],
  },
  {
    file: 'examples-invalid-example-input-too-large.yaml',
    valid: false,
    expectErrorCodes: ['example_input_too_large'],
  },
  {
    file: 'examples-invalid-example-input-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_input_invalid'],
  },
  {
    file: 'examples-invalid-example-input-unknown-field.yaml',
    valid: false,
    expectErrorCodes: ['example_input_invalid'],
  },
  {
    file: 'examples-invalid-example-input-required-missing.yaml',
    valid: false,
    expectErrorCodes: ['example_input_invalid'],
  },
  {
    file: 'examples-invalid-example-input-enum-violation.yaml',
    valid: false,
    expectErrorCodes: ['example_input_invalid'],
  },
  {
    file: 'examples-warn-example-input-unvalidated.yaml',
    valid: true,
    expectWarningCodes: ['example_input_unvalidated'],
  },
  {
    file: 'examples-invalid-example-input-undeclared-query.yaml',
    valid: false,
    expectErrorCodes: ['example_input_invalid'],
  },
  {
    file: 'examples-invalid-example-file-input-needs-ref.yaml',
    valid: false,
    expectErrorCodes: ['example_file_input_needs_ref'],
  },
  {
    file: 'examples-invalid-example-secret-value.yaml',
    valid: false,
    expectErrorCodes: ['example_secret_value'],
  },
  {
    file: 'examples-invalid-example-secret-like-value.yaml',
    valid: false,
    expectErrorCodes: ['example_secret_like_value'],
  },
  {
    file: 'examples-invalid-example-ref-scheme.yaml',
    valid: false,
    expectErrorCodes: ['example_ref_scheme'],
  },
  {
    file: 'examples-invalid-example-ref-scheme-reserved.yaml',
    valid: false,
    expectErrorCodes: ['example_ref_scheme_reserved'],
  },
  {
    file: 'examples-invalid-example-ref-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_ref_invalid'],
  },
  {
    file: 'examples-invalid-example-ref-fragment.yaml',
    valid: false,
    expectErrorCodes: ['example_ref_invalid'],
  },
  {
    file: 'examples-invalid-example-ref-url-too-long.yaml',
    valid: false,
    expectErrorCodes: ['example_ref_invalid'],
  },
  {
    file: 'examples-invalid-example-ref-sha256-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_ref_sha256_invalid'],
  },
  {
    file: 'examples-invalid-example-ref-media-type-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_ref_media_type_invalid'],
  },
  {
    file: 'examples-warn-example-ref-unpinned.yaml',
    valid: true,
    expectWarningCodes: ['example_ref_unpinned'],
  },
  {
    file: 'examples-warn-example-ref-signed-url.yaml',
    valid: true,
    expectWarningCodes: ['example_ref_signed_url'],
  },
  {
    file: 'examples-invalid-example-expected-missing.yaml',
    valid: false,
    expectErrorCodes: ['example_expected_missing'],
  },
  {
    file: 'examples-invalid-example-expected-empty.yaml',
    valid: false,
    expectErrorCodes: ['example_expected_empty'],
  },
  {
    file: 'examples-invalid-example-expected-status-alone.yaml',
    valid: false,
    expectErrorCodes: ['example_expected_empty'],
  },
  {
    file: 'examples-invalid-example-expected-conflict.yaml',
    valid: false,
    expectErrorCodes: ['example_expected_conflict'],
  },
  {
    file: 'examples-invalid-example-expected-failed-with-fields.yaml',
    valid: false,
    expectErrorCodes: ['example_expected_conflict'],
  },
  {
    file: 'examples-invalid-example-expected-field-unknown.yaml',
    valid: false,
    expectErrorCodes: ['example_expected_field_unknown'],
  },
  {
    file: 'examples-invalid-example-expected-exact-key-unknown.yaml',
    valid: false,
    expectErrorCodes: ['example_expected_field_unknown'],
  },
  {
    file: 'examples-warn-example-expected-field-unchecked.yaml',
    valid: true,
    expectWarningCodes: ['example_expected_field_unchecked'],
  },
  {
    file: 'examples-invalid-example-field-matcher-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_field_matcher_invalid'],
  },
  {
    file: 'examples-invalid-example-matcher-two-operators.yaml',
    valid: false,
    expectErrorCodes: ['example_field_matcher_invalid'],
  },
  {
    // divergence #21: a pattern is judged by length only, so a syntax error is not refused here
    file: 'examples-invalid-example-matcher-bad-regex.yaml',
    valid: false,
    expectErrorCodes: ['example_field_matcher_invalid'],
    looserHere: true,
  },
  {
    file: 'examples-invalid-example-matcher-approx-no-tolerance.yaml',
    valid: false,
    expectErrorCodes: ['example_field_matcher_invalid'],
  },
  {
    file: 'examples-invalid-example-matcher-negative-tolerance.yaml',
    valid: false,
    expectErrorCodes: ['example_field_matcher_invalid'],
  },
  {
    file: 'examples-invalid-example-rubric-empty.yaml',
    valid: false,
    expectErrorCodes: ['example_rubric_empty'],
  },
  {
    file: 'examples-invalid-example-rubric-too-long.yaml',
    valid: false,
    expectErrorCodes: ['example_rubric_too_long'],
  },
  {
    file: 'examples-invalid-example-reference-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_reference_invalid'],
  },
  {
    file: 'examples-invalid-example-reference-neither.yaml',
    valid: false,
    expectErrorCodes: ['example_reference_invalid'],
  },
  {
    file: 'examples-warn-example-reference-binary.yaml',
    valid: true,
    expectWarningCodes: ['example_reference_binary'],
  },
  {
    file: 'examples-invalid-example-must-not-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_must_not_invalid'],
  },
  {
    file: 'examples-invalid-example-must-not-contain-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_must_not_contain_invalid'],
  },
  {
    file: 'examples-warn-example-expectation-contradiction.yaml',
    valid: true,
    expectWarningCodes: ['example_expectation_contradiction'],
  },
  {
    file: 'examples-invalid-example-status-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_status_invalid'],
  },
  {
    file: 'examples-invalid-example-min-score-range.yaml',
    valid: false,
    expectErrorCodes: ['example_min_score_range'],
  },
  {
    file: 'examples-invalid-example-expectation-min-score-range.yaml',
    valid: false,
    expectErrorCodes: ['example_min_score_range'],
  },
  {
    file: 'examples-invalid-example-side-effects-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_side_effects_invalid'],
  },
  {
    file: 'examples-invalid-example-checkpoint-step-unknown.yaml',
    valid: false,
    expectErrorCodes: ['example_checkpoint_step_unknown'],
  },
  {
    file: 'examples-invalid-example-checkpoint-step-composite.yaml',
    valid: false,
    expectErrorCodes: ['example_checkpoint_step_composite'],
  },
  {
    file: 'examples-invalid-example-checkpoint-status.yaml',
    valid: false,
    expectErrorCodes: ['example_checkpoint_status'],
  },
  {
    file: 'examples-warn-example-checkpoint-field-unchecked.yaml',
    valid: true,
    expectWarningCodes: ['example_expected_field_unchecked'],
  },
  {
    file: 'examples-invalid-example-checkpoint-field-unknown.yaml',
    valid: false,
    expectErrorCodes: ['example_expected_field_unknown'],
  },
  {
    file: 'examples-invalid-example-variants-too-many.yaml',
    valid: false,
    expectErrorCodes: ['example_variants_too_many'],
  },
  {
    file: 'examples-invalid-example-variant-id-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_variant_id_invalid'],
  },
  {
    file: 'examples-invalid-example-variant-id-duplicate.yaml',
    valid: false,
    expectErrorCodes: ['example_variant_id_duplicate'],
  },
  {
    file: 'examples-invalid-example-variant-origin-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_variant_origin_invalid'],
  },
  {
    file: 'examples-invalid-example-variant-empty.yaml',
    valid: false,
    expectErrorCodes: ['example_variant_empty'],
  },
  {
    file: 'examples-invalid-example-variant-input-conflict.yaml',
    valid: false,
    expectErrorCodes: ['example_variant_input_conflict'],
  },
  {
    file: 'examples-invalid-example-variant-input-invalid.yaml',
    valid: false,
    expectErrorCodes: ['example_variant_input_invalid'],
  },
  {
    file: 'examples-invalid-example-variant-patch-secret.yaml',
    valid: false,
    expectErrorCodes: ['example_secret_value'],
  },
  {
    file: 'examples-warn-example-variant-unchecked.yaml',
    valid: true,
    expectWarningCodes: ['example_variant_unchecked'],
  },
  {
    file: 'examples-warn-examples-all-held-out.yaml',
    valid: true,
    expectWarningCodes: ['examples_all_held_out'],
  },
  {
    file: 'examples-warn-examples-published-with-public-flow.yaml',
    valid: true,
    expectWarningCodes: ['examples_published_with_public_flow'],
  },
  {
    file: 'examples-warn-examples-unreadable-by-judge.yaml',
    valid: true,
    expectWarningCodes: ['examples_unreadable_by_judge'],
  },
  {
    file: 'examples-valid-base.yaml',
    valid: true,
    forbidWarningCodes: EXAMPLE_WARNING_CODES,
  },
  {
    file: 'examples-valid-variants.yaml',
    valid: true,
    forbidWarningCodes: EXAMPLE_WARNING_CODES,
  },
  {
    file: 'examples-valid-checkpoints.yaml',
    valid: true,
    forbidWarningCodes: EXAMPLE_WARNING_CODES,
  },
  {
    file: 'examples-valid-secret-omitted.yaml',
    valid: true,
    forbidWarningCodes: EXAMPLE_WARNING_CODES,
  },
  {
    file: 'examples-valid-exact.yaml',
    valid: true,
    forbidWarningCodes: EXAMPLE_WARNING_CODES,
  },
  {
    file: 'examples-valid-prose-and-public-hosts.yaml',
    valid: true,
    forbidWarningCodes: EXAMPLE_WARNING_CODES,
  },
  {
    // AIgentFlow v2.821.0: a warning, never an error, so the flow stays valid.
    file: 'warn-compliance-residency-unenforced.yaml',
    valid: true,
    expectWarningCodes: ['compliance_residency_unenforced'],
  },
  {
    file: 'warn-compliance-residency-unenforced-loop.yaml',
    valid: true,
    expectWarningCodes: ['compliance_residency_unenforced'],
  },
  {
    // The controls, and the assertions that matter: a rule whose whole risk is a
    // false positive. Every call here is pinned, or on a provider with no region
    // lane, so the warning must not appear.
    file: 'valid-compliance-residency-pinned.yaml',
    valid: true,
    forbidWarningCodes: ['compliance_residency_unenforced'],
  },
  {
    file: 'valid-compliance-residency-silent-providers.yaml',
    valid: true,
    forbidWarningCodes: ['compliance_residency_unenforced'],
  },
  {
    // 0.28.0 — AIgentFlow v2.835.0: nexus:// is canonical, atlas:// its alias; one set of rules.
    file: 'valid-nexus-agent-run.yaml',
    valid: true,
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'valid-nexus-capability.yaml',
    valid: true,
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'valid-atlas-alias-agent-run.yaml',
    valid: true,
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'invalid-nexus-agent-missing.yaml',
    valid: false,
    expectErrorCodes: ['atlas_agent_missing'],
    forbidWarningCodes: ['unknown_executor_scheme'],
  },
  {
    file: 'invalid-nexus-loop-substep-agent-not-literal.yaml',
    valid: false,
    expectErrorCodes: ['atlas_agent_not_literal'],
  },
  {
    // The pre-2026-10-20 AigentChat shape names no Nexus operation.
    file: 'invalid-nexus-aigentchat-shape.yaml',
    valid: false,
    expectErrorCodes: ['atlas_operation_unknown'],
  },
  {
    // 0.28.0 — AIgentFlow v2.834.0 (AGENTCUT B1): signals and DFM removed.
    file: 'invalid-signal-removed-aiv-step.yaml',
    valid: false,
    expectErrorCodes: ['signal_removed'],
  },
  {
    file: 'invalid-flow-modification-removed-step.yaml',
    valid: false,
    expectErrorCodes: ['flow_modification_removed'],
  },
  {
    file: 'warn-removed-key-ignored-pre-dfm.yaml',
    valid: true,
    expectWarningCodes: ['removed_key_ignored'],
    forbidWarningCodes: ['unknown_yaml_key'],
  },
  {
    // The no-false-positive control.
    file: 'valid-signal-surfaces-not-refused.yaml',
    valid: true,
    forbidWarningCodes: ['removed_key_ignored'],
    forbidErrorCodes: ['signal_removed', 'flow_modification_removed'],
  },
  {
    // 0.28.0 — AIgentFlow v2.836.0 (AGENTCUT B2): campaigns removed.
    file: 'invalid-campaign-removed-block.yaml',
    valid: false,
    expectErrorCodes: ['campaign_removed'],
    forbidErrorCodes: ['invalid_type', 'step_not_found', 'orchestrator_removed'],
  },
  {
    file: 'invalid-campaign-removed-empty-block.yaml',
    valid: false,
    expectErrorCodes: ['campaign_removed'],
  },
  {
    file: 'invalid-campaign-removed-retired-key.yaml',
    valid: false,
    expectErrorCodes: ['campaign_removed'],
    forbidErrorCodes: ['unknown_yaml_key'],
  },
  {
    // The no-false-positive control.
    file: 'valid-campaign-surfaces-not-refused.yaml',
    valid: true,
    forbidErrorCodes: ['campaign_removed'],
  },
  // 0.29.0 — AIgentFlow v2.838.0: the orchestrator removed. The block is refused
  // whole and nothing inside it is judged.
  {
    file: 'invalid-orchestrator-removed-block.yaml',
    valid: false,
    expectErrorCodes: ['orchestrator_removed'],
  },
  {
    file: 'invalid-orchestrator-removed-empty-block.yaml',
    valid: false,
    expectErrorCodes: ['orchestrator_removed'],
  },
  {
    file: 'invalid-orchestrator-removed-scalar.yaml',
    valid: false,
    expectErrorCodes: ['orchestrator_removed'],
    forbidErrorCodes: ['invalid_type'],
  },
  {
    file: 'invalid-orchestrator-removed-inner-surfaces.yaml',
    valid: false,
    expectErrorCodes: ['orchestrator_removed'],
    forbidErrorCodes: [
      'signal_removed',
      'campaign_removed',
      'flow_modification_removed',
      'unknown_yaml_key',
      'invalid_type',
      'invalid_duration',
      ...RETIRED_ORCHESTRATOR_RULE_CODES,
    ],
    forbidWarningCodes: [
      'removed_key_ignored',
      'unknown_yaml_key',
      ...RETIRED_ORCHESTRATOR_RULE_CODES,
    ],
  },
  {
    file: 'invalid-orchestrator-removed-enable-signals-false.yaml',
    valid: false,
    expectErrorCodes: ['orchestrator_removed'],
    forbidErrorCodes: ['signal_removed'],
    forbidWarningCodes: ['removed_key_ignored'],
  },
  {
    file: 'invalid-orchestrator-removed-tool-discovery.yaml',
    valid: false,
    expectErrorCodes: ['orchestrator_removed'],
    forbidErrorCodes: ['tool_discovery_invalid'],
  },
  {
    file: 'invalid-orchestrator-removed-discoverable-tools.yaml',
    valid: false,
    expectErrorCodes: ['orchestrator_removed'],
  },
  {
    file: 'invalid-orchestrator-removed-next-default.yaml',
    valid: false,
    expectErrorCodes: ['orchestrator_removed'],
    forbidErrorCodes: ['step_not_found', 'orchestrator_next_requires_orchestrator'],
  },
  {
    file: 'invalid-orchestrator-removed-next-with-block.yaml',
    valid: false,
    expectErrorCodes: ['orchestrator_removed'],
    forbidErrorCodes: ['step_not_found', 'orchestrator_owner_needs_yield'],
  },
  {
    file: 'invalid-orchestrator-removed-next-condition.yaml',
    valid: false,
    expectErrorCodes: ['orchestrator_removed'],
    forbidErrorCodes: ['step_not_found'],
  },
  {
    // The no-false-positive control.
    file: 'valid-orchestrator-removed-not-refused.yaml',
    valid: true,
    forbidErrorCodes: ['orchestrator_removed', 'agentic_param_removed', 'tool_discovery_invalid'],
    forbidWarningCodes: ['unknown_yaml_key'],
  },
  {
    // On ai:// the step keys are agent-loop parameters, never the flow key.
    file: 'invalid-agentic-param-tool-discovery-only.yaml',
    valid: false,
    expectErrorCodes: ['agentic_param_removed'],
    forbidErrorCodes: ['orchestrator_removed', 'tool_discovery_invalid'],
  },
];

describe('conformance fixtures', () => {
  for (const c of CASES) {
    it(`${c.file} → ${c.valid ? 'valid' : 'invalid'}`, () => {
      const yaml = readFileSync(join(fixturesDir, c.file), 'utf8');
      const result = validateFlow(yaml);
      const errorCodes = new Set(result.errors.map((e) => e.code));
      const warningCodes = new Set(result.warnings.map((w) => w.code));

      if (c.looserHere) {
        expect(result.valid, `errors: ${[...errorCodes].join(', ')}`).toBe(true);
        for (const code of c.expectErrorCodes ?? []) {
          expect(errorCodes, `looser here: '${code}' must NOT be raised`).not.toContain(code);
        }
        return;
      }

      if (c.exonsEngineOnly) {
        // No .exons engine here (divergence #16): the flow must be accepted,
        // and none of the codes only an engine can produce may appear.
        expect(result.valid, `errors: ${[...errorCodes].join(', ')}`).toBe(true);
        for (const code of c.expectErrorCodes ?? []) {
          expect(errorCodes, `engine-only code '${code}' must NOT be raised here`).not.toContain(
            code,
          );
        }
        return;
      }

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

// A fixture on disk with no case would sit unasserted, and the Go port's parity
// check would still count it as shared.
describe('conformance corpus', () => {
  it('asserts every fixture exactly once', () => {
    const onDisk = readdirSync(fixturesDir)
      .filter((f) => f.endsWith('.yaml'))
      .sort();
    const asserted = CASES.map((c) => c.file).sort();
    expect(asserted).toEqual(onDisk);
  });
});
