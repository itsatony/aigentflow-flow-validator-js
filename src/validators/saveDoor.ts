// Three save-door refusals from `FlowParser.ValidateFlow` (parser.go) that are
// pure functions of the document: the `tool_discovery` vocabulary, the mock
// scenario `delay`, and an empty `output:` entry.
//
// Every one is an ERROR, because the reference refuses the flow at save. Two of
// them (tool_discovery, mock delay) are routed through the reference's
// `refuseRetroactively`, so a flow stored before the rule existed is only
// logged at the load door and still runs. This validator answers "would this
// save", so it reports them as errors — the same choice as the executor-URL
// shape rule (PARITY.md, divergence #10).

import type { Flow } from '../types.js';
import { Issues, isRecord, isString, parseGoDuration, scalarText } from './util.js';

/** The closed `tool_discovery` vocabulary (reference: IsValidDiscoveryMode). */
const TOOL_DISCOVERY_MODES: ReadonlySet<string> = new Set(['eager', 'lazy', 'off']);
const TEMPLATE_ACTION_OPEN = '{{';
const KEY_TOOL_DISCOVERY = 'tool_discovery';

export function validateSaveDoorExtras(flow: Flow, issues: Issues): void {
  validateToolDiscovery(flow, issues);
  validateMockScenarioDelays(flow, issues);
  validateOutputParameters(flow, issues);
}

// validateToolDiscovery mirrors validateToolDiscoveryVocabulary (AIF
// DC-FORGE-48). The value decides TOOL EXPOSURE, and every consuming switch
// treats an unknown value as `eager` — so `tool_discovery: of`, a typo for
// `off`, injected every tool. An empty value means "unset" and a templated one
// is rendered at run time; both are skipped.
//
// The flow root and the orchestrator carry a Go `string` field, which yaml.v3
// fills from ANY scalar: `tool_discovery: 5` is the string "5" and is refused.
// On a step the surface is a free-form `query` key, so only a YAML string is
// judged there — a number or boolean is left to the executor.
function validateToolDiscovery(flow: Flow, issues: Issues): void {
  const check = (value: string | null, field: string, stepId?: string): void => {
    if (value === null || value === '' || value.includes(TEMPLATE_ACTION_OPEN)) return;
    if (TOOL_DISCOVERY_MODES.has(value)) return;
    issues.error({
      field,
      message: `tool_discovery '${value}' is not a recognised mode`,
      code: 'tool_discovery_invalid',
      ...(stepId !== undefined ? { stepId } : {}),
      suggestion: `Use one of: ${[...TOOL_DISCOVERY_MODES].join(', ')}, or omit the key`,
    });
  };

  if (KEY_TOOL_DISCOVERY in flow) {
    check(scalarText(flow[KEY_TOOL_DISCOVERY]), KEY_TOOL_DISCOVERY);
  }
  const orch: unknown = flow.orchestrator;
  if (isRecord(orch) && KEY_TOOL_DISCOVERY in orch) {
    check(scalarText(orch[KEY_TOOL_DISCOVERY]), `orchestrator.${KEY_TOOL_DISCOVERY}`);
  }
  if (!isRecord(flow.steps)) return;
  for (const [stepID, step] of Object.entries(flow.steps as Record<string, unknown>)) {
    if (!isRecord(step) || !isRecord(step.query)) continue;
    const value: unknown = step.query[KEY_TOOL_DISCOVERY];
    if (!isString(value)) continue;
    check(value, `steps.${stepID}.query.${KEY_TOOL_DISCOVERY}`, stepID);
  }
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
      const delay = scalarText(mock.delay);
      if (delay === null || delay === '') continue;
      if (parseGoDuration(delay) !== null) continue;
      issues.error({
        field: `mock_scenarios.${scenario}.${stepID}.delay`,
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
