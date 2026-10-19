// 0.23.0: unknown_function_operation and the improved unknown_executor_scheme text.

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';
import { FUNCTION_OPERATIONS } from '../src/spec/index.js';

const flowWith = (executor: string): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
steps:
  only:
    executor: ${executor}
`;

const CODE = 'unknown_function_operation';
const LIST = [...FUNCTION_OPERATIONS.sorted].join(', ');

describe('unknown_function_operation', () => {
  it('has the 32 reference operations, sorted', () => {
    expect(FUNCTION_OPERATIONS.sorted).toHaveLength(32);
    expect([...FUNCTION_OPERATIONS.sorted].sort()).toEqual([...FUNCTION_OPERATIONS.sorted]);
  });

  it.each([...FUNCTION_OPERATIONS.sorted])('accepts function://%s', (op) => {
    const r = validateFlow(flowWith(`function://${op}`));
    expect(r.errors.filter((e) => e.code === CODE)).toEqual([]);
  });

  it('refuses an unregistered operation with the reference message', () => {
    const r = validateFlow(flowWith('function://utils/noop'));
    const found = r.errors.filter((e) => e.code === CODE);
    expect(found).toHaveLength(1);
    expect(found[0]!.field).toBe('steps.only.executor');
    expect(found[0]!.stepId).toBe('only');
    expect(found[0]!.message).toBe(
      `step "only" uses function://utils/noop, which is not a built-in function. Available: ${LIST}`,
    );
    expect(found[0]!.suggestion).toContain(LIST);
    expect(r.valid).toBe(false);
  });

  it('composes the loop sub-step id as <step>.<sub>', () => {
    const y = `aigentflow_version: "2.0.0"
name: t
version: 1.0.0
start: s
steps:
  s:
    loop:
      while: '{{ lt (atoi .loop.vars.n) 3 }}'
      max_iterations: 3
      vars:
        n: '0'
      steps:
        - id: body
          executor: function://text/template
`;
    const found = validateFlow(y).errors.filter((e) => e.code === CODE);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('step "s.body" uses function://text/template');
  });

  it('skips templated executors and other schemes', () => {
    expect(
      validateFlow(flowWith("'function://{{ .query.op }}'")).errors.filter((e) => e.code === CODE),
    ).toEqual([]);
    expect(
      validateFlow(flowWith('script://utils/noop')).errors.filter((e) => e.code === CODE),
    ).toEqual([]);
  });

  it('leaves an unparsable function URL to invalid_executor_url', () => {
    const r = validateFlow(flowWith('function://noslash'));
    expect(r.errors.some((e) => e.code === CODE)).toBe(false);
    expect(r.errors.some((e) => e.code === 'invalid_executor_url')).toBe(true);
  });
});

describe('unknown_executor_scheme message', () => {
  const warning = (executor: string) =>
    validateFlow(flowWith(executor)).warnings.find((w) => w.code === 'unknown_executor_scheme');

  it('points decide at ai://<provider>/decide, still a warning', () => {
    const w = warning('decide://openai/model');
    expect(w!.message).toContain(
      'Decision models run through ai://{provider}/decide (for example ai://openai/decide), not through a scheme of their own.',
    );
    expect(validateFlow(flowWith('decide://openai/model')).valid).toBe(true);
  });

  it('suggests a near scheme within edit distance 2, case-insensitively', () => {
    expect(warning('functon://a/b')!.message).toContain("Did you mean 'function'?");
    expect(warning('FUNCTIONS://a/b')!.message).toContain("Did you mean 'function'?");
  });

  it('adds no suggestion when nothing is close', () => {
    expect(warning('zzzzzzzz://a/b')!.message).not.toContain('Did you mean');
  });
});
