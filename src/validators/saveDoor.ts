// Two save-door refusals from `FlowParser.ValidateFlow` (parser.go) that are
// pure functions of the document: the mock scenario `delay`, and an empty
// `output:` entry. (The `tool_discovery` vocabulary rule went with the
// orchestrator in AIgentFlow v2.838.0: the flow-level key is
// `orchestrator_removed`, and nothing reads the vocabulary any more.)
//
// Both are ERRORS, because the reference refuses the flow at save. The mock
// delay is routed through the reference's `refuseRetroactively`, so a flow
// stored before the rule existed is only logged at the load door and still
// runs. This validator answers "would this save", so it reports it as an error
// — the same choice as the executor-URL shape rule (PARITY.md, divergence #10).

import type { Flow } from '../types.js';
import { Issues, isRecord, parseGoDuration } from './util.js';

export function validateSaveDoorExtras(flow: Flow, issues: Issues): void {
  validateMockScenarioDelays(flow, issues);
  validateOutputParameters(flow, issues);
}

// validateMockScenarioDelays mirrors the reference rule of the same name (AIF
// DC-FORGE-51). yaml.v3 decodes `delay: 100` into the string "100", which has
// no unit; the live call site discarded the parse error and ran with NO delay.
// The reference refuses anything `time.ParseDuration` rejects rather than
// guessing a unit, so `100` is refused and `100ms` saves.
//
// Every scenario and every step key is checked, including a step id the flow
// does not define — the reference walks the map, not the step table.
function validateMockScenarioDelays(flow: Flow, issues: Issues): void {
  const scenarios: unknown = flow.mock_scenarios;
  if (!isRecord(scenarios)) return;
  for (const [scenario, steps] of Object.entries(scenarios)) {
    if (!isRecord(steps)) continue;
    for (const [stepID, mock] of Object.entries(steps)) {
      if (!isRecord(mock)) continue;
      const field = `mock_scenarios.${scenario}.${stepID}.delay`;
      // Judged by the SOURCE spelling: `delay: 0.0` is the text "0.0" to the
      // reference (no unit, refused) although it parses to the number 0.
      const delay = issues.stringAt(mock.delay, field);
      if (delay === null || delay === '') continue;
      if (parseGoDuration(delay) !== null) continue;
      issues.error({
        field,
        message: `mock delay '${delay}' in scenario '${scenario}' step '${stepID}' is not a Go duration`,
        code: 'mock_delay_invalid',
        suggestion: 'Write a unit, e.g. "100ms" or "2s"; a bare number would run with no delay',
      });
    }
  }
}

// validateOutputParameters mirrors the reference rule of the same name. Only
// an empty STRING is refused: a YAML null entry (`- ` or `- ~`) is dropped by
// yaml.v3 when it decodes the list, so it never reaches the check and the flow
// saves (measured against the reference).
function validateOutputParameters(flow: Flow, issues: Issues): void {
  const output: unknown = flow.output;
  if (!Array.isArray(output)) return;
  output.forEach((entry: unknown, i: number) => {
    if (entry !== '') return;
    issues.error({
      field: `output[${i}]`,
      message: `output entry ${i} is an empty string`,
      code: 'output_param_empty',
      suggestion: 'Name the output parameter, or remove the entry',
    });
  });
}
