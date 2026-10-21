// 0.28.0 — AIgentFlow v2.834.0 … v2.837.0: nexus:// canonical with atlas:// as
// its alias (v2.835.0), signals and DFM removed (v2.834.0, AGENTCUT B1),
// campaigns removed (v2.836.0, AGENTCUT B2), and the removal advice no longer
// naming share links (v2.837.0). The conformance fixtures carry the verdicts;
// these tests pin fields, cardinality, messages and the no-false-positive edges.

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';
import spec from '../src/spec/aigentflow-spec.json';

type Result = ReturnType<typeof validateFlow>;

const probe = (executor: string, query = ''): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: s
steps:
  s:
    executor: ${executor}
${query === '' ? '' : `    query:\n${query}`}`;

const MINIMAL = `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
steps:
  only:
    executor: function://utils/log
`;

const ORCH_DOC = (frontmatterExtra: string): string =>
  [
    '---',
    'name: orch',
    'description: coordinates',
    'type: agent',
    'execution: {provider: anthropic, model: m}',
    ...frontmatterExtra.split('\n').filter((l) => l !== ''),
    '---',
    'hi',
  ]
    .map((l) => `    ${l}`)
    .join('\n');

const orchFlow = (frontmatterExtra: string, orchExtra: string, flowExtra = ''): string =>
  `${MINIMAL}${flowExtra}orchestrator:\n  agentic: true\n${orchExtra}  exons: |\n${ORCH_DOC(frontmatterExtra)}\n`;

const keys = (list: Result['errors']): string[] =>
  list.map((i) => `${i.code}@${i.field}#${i.stepId ?? ''}`);
const fields = (list: Result['errors'], code: string): string[] =>
  list
    .filter((i) => i.code === code)
    .map((i) => i.field)
    .sort();
const codes = (list: Result['errors']): string[] => list.map((i) => i.code);

describe('nexus:// and its alias atlas://', () => {
  // Equal is not enough (both spellings could be equally wrong), so each probe
  // also pins the code it must produce.
  it.each([
    ['clean agent run', 'agent/run', "      agent: '@a/b'\n      prompt: hi\n", ''],
    ['clean capability', 'capability/web_fetch', '      url: https://example.com\n', ''],
    ['agent missing', 'agent/run', '      prompt: hi\n', 'atlas_agent_missing'],
    [
      'agent not literal',
      'agent/run',
      "      agent: '{{ .query.a }}'\n      prompt: hi\n",
      'atlas_agent_not_literal',
    ],
    ['prompt missing', 'agent/run', "      agent: '@a/b'\n", 'atlas_prompt_missing'],
    [
      'prompt both',
      'agent/run',
      "      agent: '@a/b'\n      prompt: hi\n      prompt_template: x\n",
      'atlas_prompt_both',
    ],
    [
      'capabilities not literal',
      'agent/run',
      "      agent: '@a/b'\n      prompt: hi\n      capabilities: ['{{ .query.c }}']\n",
      'atlas_capabilities_not_literal',
    ],
    [
      'model not literal',
      'agent/run',
      "      agent: '@a/b'\n      prompt: hi\n      model: '{{ .query.m }}'\n",
      'atlas_model_not_literal',
    ],
    [
      'param refused',
      'agent/run',
      "      agent: '@a/b'\n      prompt: hi\n      user_id: x\n",
      'atlas_param_refused',
    ],
    ['capability ref invalid', 'capability/a.b', '      x: 1\n', 'atlas_capability_ref_invalid'],
    ['operation unknown', 'acme/reporter', '      x: 1\n', 'atlas_operation_unknown'],
  ])('%s: both spellings answer the same', (_name, path, query, want) => {
    const nexus = validateFlow(probe(`nexus://${path}`, query));
    const atlas = validateFlow(probe(`atlas://${path}`, query));
    expect(keys(nexus.errors)).toEqual(keys(atlas.errors));
    expect(keys(nexus.warnings)).toEqual(keys(atlas.warnings));
    expect(codes(nexus.warnings)).not.toContain('unknown_executor_scheme');
    if (want === '') {
      expect(nexus.valid, JSON.stringify(nexus.errors)).toBe(true);
    } else {
      expect(nexus.errors.find((e) => e.code === want)?.field).toBe('steps.s');
    }
  });

  it('matches the scheme exactly', () => {
    const r = validateFlow(probe('nexusx://agent/run', '      prompt: hi\n'));
    expect(codes(r.errors)).not.toContain('atlas_agent_missing');
  });

  it('writes nexus:// in its messages and the removal advice', () => {
    const r = validateFlow(probe('atlas://capability/a.b', '      x: 1\n'));
    expect(r.errors.find((e) => e.code === 'atlas_capability_ref_invalid')?.message).toContain(
      'nexus://capability/a.b',
    );
    const advice = spec.removedAgentSurfaces.suggestion;
    expect(advice).toContain('share links no longer exist');
    expect(advice).not.toContain('a share link,');
    expect(advice).not.toContain('atlas://');
  });
});

describe('signal_removed / flow_modification_removed (AIgentFlow v2.834.0)', () => {
  it.each(['~', 'false', 'true'])('refuses enable_signals: %s on aiv://', (v) => {
    const r = validateFlow(probe('aiv://acme/x', `      topic: t\n      enable_signals: ${v}\n`));
    expect(fields(r.errors, 'signal_removed')).toEqual(['steps.s']);
  });

  it('leaves enable_signals on ai:// to agentic_param_removed, and ignores it elsewhere', () => {
    const ai = validateFlow(
      probe('ai://openai/chat', '      prompt: hi\n      enable_signals: true\n'),
    );
    expect(codes(ai.errors)).toContain('agentic_param_removed');
    expect(codes(ai.errors)).not.toContain('signal_removed');
    for (const ex of ['http://example/get', 'nexus://agent/run', 'flow://stored/c']) {
      const r = validateFlow(
        probe(ex, "      agent: '@a/b'\n      prompt: hi\n      enable_signals: true\n"),
      );
      expect(codes(r.errors), ex).not.toContain('signal_removed');
    }
  });

  it('refuses flow_modification_allowed on presence, except on flow:// and templated executors', () => {
    for (const v of ['~', 'false']) {
      const r = validateFlow(
        probe(
          'http://example/get',
          `      url: https://x\n      flow_modification_allowed: ${v}\n`,
        ),
      );
      expect(fields(r.errors, 'flow_modification_removed')).toEqual(['steps.s']);
    }
    for (const ex of ['flow://stored/c', "'http://{{ .query.h }}/get'"]) {
      const r = validateFlow(probe(ex, '      flow_modification_allowed: true\n'));
      expect(codes(r.errors), ex).not.toContain('flow_modification_removed');
    }
  });

  it('lets a removed scheme yield only executor_removed', () => {
    const r = validateFlow(
      probe('exons://agent/execute', '      flow_modification_allowed: true\n'),
    );
    expect(codes(r.errors)).toContain('executor_removed');
    expect(codes(r.errors)).not.toContain('flow_modification_removed');
  });

  it('addresses a loop sub-step by its path and composite id', () => {
    const r = validateFlow(
      MINIMAL +
        "  spin:\n    loop:\n      while: '{{ lt .loop.index 2 }}'\n      max_iterations: 2\n      steps:\n" +
        '        - id: ask\n          executor: aiv://acme/x\n          query:\n' +
        '            enable_signals: true\n            flow_modification_allowed: true\n',
    );
    for (const code of ['signal_removed', 'flow_modification_removed']) {
      const found = r.errors.find((e) => e.code === code);
      expect(found?.field, code).toBe('steps.spin.loop.steps[0]');
      expect(found?.stepId, code).toBe('spin.ask');
    }
  });

  it('warns removed_key_ignored for checkpoint.pre_dfm, and a null is absent', () => {
    const r = validateFlow(`${MINIMAL}checkpoint:\n  pre_dfm: false\n`);
    expect(r.valid, JSON.stringify(r.errors)).toBe(true);
    expect(fields(r.warnings, 'removed_key_ignored')).toEqual(['checkpoint.pre_dfm']);
    expect(codes(r.warnings)).not.toContain('unknown_yaml_key');
    const nulls = validateFlow(`${MINIMAL}checkpoint:\n  pre_dfm: ~\n`);
    expect(codes(nulls.warnings)).not.toContain('removed_key_ignored');
  });

  it('judges nothing inside the refused orchestrator block (AIgentFlow v2.838.0)', () => {
    const r = validateFlow(
      orchFlow(
        'tools:\n  allow: [aif_ask_human, aif_signal_need_tool]\n',
        '  enable_signals: false\n  tools: [aif_signal_complete, aif_campaign_spawn]\n' +
          '  triggers:\n    - type: dfm_suggestion\n    - type: campaign_child_failed\n',
      ),
      { strictRegistries: true },
    );
    expect(keys(r.errors)).toEqual(['orchestrator_removed@orchestrator#']);
    expect(r.warnings).toEqual([]);
  });
});

describe('campaign_removed (AIgentFlow v2.836.0)', () => {
  it.each([
    'campaign: {}\n',
    'campaign: []\n',
    'campaign: 1\n',
    'campaign:\n  budget_max_per_child: 1\n',
  ])('refuses the block on presence: %j', (body) => {
    const r = validateFlow(MINIMAL + body);
    expect(fields(r.errors, 'campaign_removed')).toEqual(['campaign']);
    expect(codes(r.errors)).not.toContain('unknown_yaml_key');
    expect(codes(r.errors)).not.toContain('invalid_type');
  });

  it('treats campaign: null as absent', () => {
    expect(codes(validateFlow(`${MINIMAL}campaign: ~\n`).errors)).not.toContain('campaign_removed');
  });

  it('never judges a step', () => {
    const r = validateFlow(
      probe('flow://stored/c', '      campaign: x\n      max_credits_per_child: 3\n'),
    );
    expect(codes(r.errors)).not.toContain('campaign_removed');
  });
});

describe('the spec', () => {
  it('types the removed blocks as any, so nothing inside them is an unknown key', () => {
    const root = (spec.knownKeys.types as Record<string, Record<string, string>>)[
      spec.knownKeys.root
    ]!;
    for (const key of ['campaign', 'orchestrator', 'tool_discovery', 'discoverable_tools']) {
      expect(root[key], key).toBe('any');
    }
    expect('CampaignConfig' in spec.knownKeys.types).toBe(false);
    expect('OrchestratorDefinition' in spec.knownKeys.types).toBe(false);
  });
});
