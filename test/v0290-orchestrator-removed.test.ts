// 0.29.0 — AIgentFlow v2.838.0: the orchestrator is removed. The block is refused
// WHOLE as orchestrator_removed and nothing inside it is judged; the flow-level
// tool_discovery / discoverable_tools and `next: orchestrator` are
// orchestrator_removed too. The conformance fixtures carry the verdicts; these
// tests pin fields, step ids, cardinality, presence and the no-false-positive
// edges. (Same cases as the Go port's validate_v0190_test.go.)

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';
import spec from '../src/spec/aigentflow-spec.json';

type Result = ReturnType<typeof validateFlow>;

const MINIMAL = `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
steps:
  only:
    executor: function://utils/log
`;

const withNext = (next: string): string => `${MINIMAL}    next:\n${next}`;

const probe = (executor: string, query: string): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: s
steps:
  s:
    executor: ${executor}
    query:
${query}`;

const keys = (list: Result['errors']): string[] =>
  list.map((i) => `${i.code}@${i.field}#${i.stepId ?? ''}`);
const codes = (list: Result['errors']): string[] => list.map((i) => i.code);

describe('orchestrator_removed: the block', () => {
  it.each([
    'orchestrator: {}\n',
    'orchestrator: []\n',
    'orchestrator: 1\n',
    'orchestrator: true\n',
    'orchestrator: monitor\n',
    'orchestrator:\n  not_a_real_key: 1\n  mode: monitor\n',
  ])('is ONE finding at orchestrator for any non-null value: %j', (body) => {
    const r = validateFlow(MINIMAL + body);
    expect(keys(r.errors)).toEqual(['orchestrator_removed@orchestrator#']);
    expect(r.errors[0]?.suggestion).toBe(spec.removedOrchestratorSurfaces.suggestion);
    expect(codes(r.warnings)).not.toContain('unknown_yaml_key');
  });

  it.each(['orchestrator:\n', 'orchestrator: ~\n', 'orchestrator: null\n'])(
    'treats a YAML null as absent: %j',
    (body) => {
      expect(validateFlow(MINIMAL + body).valid).toBe(true);
    },
  );

  it('judges nothing inside the block, with strictRegistries too', () => {
    const inner =
      '  mode: owner\n  agentic: false\n  enforce_region: true\n  human_question_timeout: -5m\n' +
      '  enable_signals: true\n  tool_discovery: of\n' +
      '  triggers:\n    - type: timer\n    - type: eclipse\n    - type: dfm_suggestion\n    - type: campaign_child_failed\n' +
      '  tools: [aif_ask_human, aif_signal_complete, aif_campaign_spawn, not_a_tool]\n' +
      '  deny_tools: [aif_signal_delegate]\n  require_approval_for: [aif_campaign_cancel]\n' +
      '  exons: |\n    ---\n    name: o\n    tools:\n      allow: []\n    requirements:\n      resources:\n        - {ref: a, kind: toolset}\n    ---\n    hi\n';
    for (const strictRegistries of [false, true]) {
      const r = validateFlow(`${MINIMAL}orchestrator:\n${inner}`, { strictRegistries });
      expect(keys(r.errors)).toEqual(['orchestrator_removed@orchestrator#']);
      expect(r.warnings).toEqual([]);
    }
  });
});

describe('orchestrator_removed: the flow-level discovery keys', () => {
  for (const key of ['tool_discovery', 'discoverable_tools']) {
    it.each(["''", 'lazy', 'of', '5', '[]', '[search]', '{}'])(`${key}: %s`, (value) => {
      const r = validateFlow(`${MINIMAL}${key}: ${value}\n`);
      expect(keys(r.errors)).toEqual([`orchestrator_removed@${key}#`]);
      expect(r.errors[0]?.message).toContain(`"${key}"`);
    });
    it(`${key}: ~ is absent`, () => {
      expect(validateFlow(`${MINIMAL}${key}: ~\n`).valid).toBe(true);
    });
  }

  it('reports one finding each, block first, then the keys, then the steps', () => {
    const r = validateFlow(
      withNext('      default: orchestrator\n') +
        "discoverable_tools: []\ntool_discovery: ''\norchestrator: {}\n",
    );
    expect(keys(r.errors)).toEqual([
      'orchestrator_removed@orchestrator#',
      'orchestrator_removed@tool_discovery#',
      'orchestrator_removed@discoverable_tools#',
      'orchestrator_removed@steps.only#only',
    ]);
  });
});

describe('orchestrator_removed: next: orchestrator', () => {
  it.each([
    ['default', '      default: orchestrator\n'],
    [
      'condition',
      "      conditions:\n        - if: '{{ true }}'\n          goto: orchestrator\n      default: 'null'\n",
    ],
    [
      'default and two goto',
      "      conditions:\n        - if: '{{ true }}'\n          goto: orchestrator\n        - if: '{{ false }}'\n          goto: orchestrator\n      default: orchestrator\n",
    ],
  ])('is one finding per step at steps.<id> (%s)', (_name, next) => {
    expect(keys(validateFlow(withNext(next)).errors)).toEqual([
      'orchestrator_removed@steps.only#only',
    ]);
  });

  it('matches exactly: Orchestrator is a step reference', () => {
    const r = validateFlow(withNext('      default: Orchestrator\n'));
    expect(codes(r.errors)).toContain('step_not_found');
    expect(codes(r.errors)).not.toContain('orchestrator_removed');
  });

  it('leaves a loop sub-step to loop_substep_next_sentinel', () => {
    const r = validateFlow(
      MINIMAL +
        "  spin:\n    loop:\n      while: '{{ lt .loop.index 2 }}'\n      max_iterations: 2\n      steps:\n" +
        '        - id: a\n          executor: function://utils/log\n          next:\n            default: orchestrator\n',
    );
    expect(codes(r.errors)).toEqual(['loop_substep_next_sentinel']);
  });
});

describe('orchestrator_removed never judges a step query', () => {
  it('a flow:// child input named orchestrator is the child input', () => {
    const r = validateFlow(
      probe(
        'flow://stored/c',
        '      orchestrator: x\n      tool_discovery: of\n      discoverable_tools: [a]\n',
      ),
    );
    expect(codes(r.errors)).not.toContain('orchestrator_removed');
  });
  it('a mock:// tool_discovery is just a key', () => {
    expect(validateFlow(probe('mock://api/x', '      tool_discovery: of\n')).valid).toBe(true);
  });
  it('on ai:// it is agentic_param_removed only', () => {
    const r = validateFlow(
      probe('ai://openai/chat', '      prompt: hi\n      tool_discovery: lazy\n'),
    );
    expect(codes(r.errors)).toEqual(['agentic_param_removed']);
  });
});

describe('the other removed surfaces, as amended in 0.29.0', () => {
  it('gives a flow with both removed blocks one finding for each', () => {
    const r = validateFlow(
      `${MINIMAL}campaign:\n  child_flows: []\norchestrator:\n  mode: monitor\n`,
    );
    expect(keys(r.errors)).toEqual([
      'campaign_removed@campaign#',
      'orchestrator_removed@orchestrator#',
    ]);
  });

  it('treats exons_uploads: null as absent (a typed block in the reference)', () => {
    expect(validateFlow(`${MINIMAL}exons_uploads: ~\n`).valid).toBe(true);
    expect(keys(validateFlow(`${MINIMAL}exons_uploads: {}\n`).errors)).toEqual([
      'executor_removed@exons_uploads#',
    ]);
  });

  it("carries the reference's current advice texts", () => {
    const orch = spec.removedOrchestratorSurfaces.suggestion;
    expect(orch).toContain('removed in 2.838.0');
    expect(orch).toContain('nexus://agent/run');
    expect(orch).not.toContain('atlas://');
    const sig = spec.removedSignalSurfaces.suggestion;
    expect(
      sig.startsWith(
        'Signals and dynamic flow modification were removed in 2.834.0. enable_signals: delete it;',
      ),
    ).toBe(true);
    expect(sig).not.toContain('aif_signal_');
    expect(sig).not.toContain('dfm_suggestion');
    expect(spec.removedCampaignSurfaces.suggestion.endsWith('Delete the campaign: block')).toBe(
      true,
    );
    expect(spec.complianceResidency.suggestion).not.toContain('orchestrator');
  });
});
