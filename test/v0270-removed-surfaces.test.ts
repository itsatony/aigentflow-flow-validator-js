// 0.27.0: executor_removed and agentic_param_removed. The conformance fixtures
// carry the verdicts; these tests pin the exact semantics a subset comparison
// cannot say (one finding per step, sorted keys, field and step id, every key).

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';

const MINIMAL = `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
steps:
  only:
    executor: function://utils/log
`;

const withExecutor = (executor: string, query = ''): string =>
  MINIMAL.replace('function://utils/log', executor) + query;
const aiStep = (query: string): string => withExecutor('ai://openai/chat', `    query:\n${query}`);
const codes = (items: { code: string }[]): string[] => items.map((i) => i.code);
const withCode = (r: ReturnType<typeof validateFlow>, code: string) =>
  [...r.errors, ...r.warnings].filter((i) => i.code === code);

const KEYS = [
  'agentic',
  'max_tool_turns',
  'parallel_tool_calls',
  'mcp_server_url',
  'tool_auth_token',
  'tool_discovery',
  'discoverable_tools',
  'enable_signals',
  'deny_tools',
  'max_tool_calls',
  'require_confirmation',
  'guardrails',
  'timeout_seconds',
];

describe('executor_removed', () => {
  it.each(['exons://agent/execute', 'exons://upload/slot', 'agent://modify/flow', 'exons:///bad'])(
    'an %s step yields ONLY executor_removed, addressed to the step',
    (executor) => {
      const r = validateFlow(withExecutor(executor));
      expect(codes(r.errors)).toEqual(['executor_removed']);
      expect(r.warnings).toEqual([]);
      expect(r.errors[0]!.field).toBe('steps.only');
      expect(r.errors[0]!.stepId).toBe('only');
    },
  );

  it.each(["' EXONS://agent/execute '", 'Agent://x/y'])(
    'case and whitespace do not hide the scheme: %s',
    (executor) => {
      const r = validateFlow(withExecutor(executor));
      expect(withCode(r, 'executor_removed')).toHaveLength(1);
    },
  );

  it('does not judge a templated executor', () => {
    const r = validateFlow(withExecutor("'exons://{{ .query.x }}'"));
    expect(withCode(r, 'executor_removed')).toEqual([]);
  });

  it('addresses a loop sub-step by its index', () => {
    const r = validateFlow(
      MINIMAL +
        `  loopy:
    loop:
      while: '{{ lt .loop.index 2 }}'
      max_iterations: 2
      steps:
        - id: a
          executor: function://utils/log
        - id: b
          executor: agent://modify/flow
`,
    );
    const found = withCode(r, 'executor_removed');
    expect(found.map((i) => i.field)).toEqual(['steps.loopy.loop.steps[1]']);
    expect(found[0]!.stepId).toBe('loopy.b');
  });

  it('refuses the exons_uploads key at the key itself', () => {
    const r = validateFlow(MINIMAL + 'exons_uploads:\n  allowed_providers: [anthropic]\n');
    expect(withCode(r, 'executor_removed').map((i) => i.field)).toEqual(['exons_uploads']);
    expect(withCode(r, 'unknown_yaml_key')).toEqual([]);
  });

  it("leaves the orchestrator's own exons document alone", () => {
    const r = validateFlow(
      MINIMAL +
        'orchestrator:\n  exons: |\n    ---\n    name: o\n    description: d\n    execution:\n      provider: anthropic\n    ---\n    hi\n',
    );
    expect(withCode(r, 'executor_removed')).toEqual([]);
  });
});

describe('agentic_param_removed', () => {
  it('reports ONE finding per step with the keys sorted', () => {
    const r = validateFlow(
      aiStep('      max_tool_turns: 3\n      agentic: true\n      guardrails: {}\n'),
    );
    const found = withCode(r, 'agentic_param_removed');
    expect(found).toHaveLength(1);
    expect(found[0]!.field).toBe('steps.only');
    expect(found[0]!.message).toContain('agentic, guardrails, max_tool_turns');
  });

  it("has the contract's thirteen keys", () => {
    expect(KEYS).toHaveLength(13);
  });

  it.each(KEYS.flatMap((k) => ['true', 'false', 'null', '5'].map((v) => [k, v] as const)))(
    'refuses %s: %s on presence',
    (key, value) => {
      const r = validateFlow(aiStep(`      ${key}: ${value}\n`));
      expect(withCode(r, 'agentic_param_removed')).toHaveLength(1);
    },
  );

  it('keeps what stays legal on ai://', () => {
    const q =
      '      tools: []\n      tool_choice: auto\n      autofix: true\n      content_parts: []\n      stream: true\n      persist_conversation: true\n';
    expect(withCode(validateFlow(aiStep(q)), 'agentic_param_removed')).toEqual([]);
  });

  it.each(['aiv://acme/helper', 'atlas://agent/run', 'http://post/x', 'function://utils/log'])(
    'only judges the ai scheme (%s)',
    (executor) => {
      const r = validateFlow(
        withExecutor(executor, '    query:\n      agentic: true\n      timeout_seconds: 5\n'),
      );
      expect(withCode(r, 'agentic_param_removed')).toEqual([]);
    },
  );

  it('does not judge a templated executor', () => {
    const r = validateFlow(withExecutor("'{{ .query.e }}'", '    query:\n      agentic: true\n'));
    expect(withCode(r, 'agentic_param_removed')).toEqual([]);
  });

  it('leaves the flow-level discovery keys alone', () => {
    const r = validateFlow(MINIMAL + 'tool_discovery: lazy\ndiscoverable_tools: [a]\n');
    expect(withCode(r, 'agentic_param_removed')).toEqual([]);
  });

  it('addresses a loop sub-step by its index', () => {
    const r = validateFlow(
      MINIMAL +
        `  loopy:
    loop:
      while: '{{ lt .loop.index 2 }}'
      max_iterations: 2
      steps:
        - id: a
          executor: ai://openai/chat
          query:
            enable_signals: true
`,
    );
    expect(withCode(r, 'agentic_param_removed').map((i) => i.field)).toEqual([
      'steps.loopy.loop.steps[0]',
    ]);
  });
});
