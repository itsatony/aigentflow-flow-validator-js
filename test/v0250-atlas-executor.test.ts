// 0.25.0: the atlas:// executor scheme and its rules.

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';

const flow = (executor: string, query = ''): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
steps:
  only:
    executor: ${executor}
${query === '' ? '' : `    query:\n${query}`}`;

const codes = (y: string): string[] => validateFlow(y).errors.map((e) => e.code ?? '');

describe('atlas:// executor', () => {
  it('is a known scheme', () => {
    const r = validateFlow(flow('atlas://agent/run', "      agent: '@a/b'\n      prompt: hi\n"));
    expect(r.warnings.filter((w) => w.code === 'unknown_executor_scheme')).toEqual([]);
  });

  it('reports the step as the field and the step id', () => {
    const r = validateFlow(flow('atlas://agent/run', '      prompt: hi\n'));
    const found = r.errors.filter((e) => e.code === 'atlas_agent_missing');
    expect(found).toHaveLength(1);
    expect(found[0]!.field).toBe('steps.only');
    expect(found[0]!.stepId).toBe('only');
    expect(found[0]!.message).toBe(
      'step "only" runs a Nexus agent but query.agent is missing, empty or not a string.',
    );
  });

  it('treats an empty agent as missing', () => {
    expect(codes(flow('atlas://agent/run', "      agent: ''\n      prompt: hi\n"))).toContain(
      'atlas_agent_missing',
    );
  });

  it('refuses an unknown provider and a wrong agent resource', () => {
    expect(codes(flow('atlas://bogus/x'))).toEqual(['atlas_operation_unknown']);
    expect(codes(flow('atlas://agent/start', "      agent: '@a/b'\n"))).toEqual([
      'atlas_operation_unknown',
    ]);
  });

  it('checks capability references against the pattern', () => {
    expect(codes(flow('atlas://capability/calc_evaluate'))).toEqual([]);
    expect(codes(flow('atlas://capability/a1'))).toEqual([]);
    expect(codes(flow('atlas://capability/_x'))).toEqual(['atlas_capability_ref_invalid']);
    expect(codes(flow('atlas://capability/a/b'))).toEqual(['atlas_capability_ref_invalid']);
    expect(codes(flow(`atlas://capability/a${'b'.repeat(128)}`))).toEqual([
      'atlas_capability_ref_invalid',
    ]);
    expect(codes(flow(`atlas://capability/a${'b'.repeat(127)}`))).toEqual([]);
  });

  it('skips a templated executor', () => {
    expect(codes(flow("'atlas://{{ .query.p }}/run'"))).toEqual([]);
  });

  it('applies to a loop sub-step with the composite step id', () => {
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
          executor: atlas://agent/run
          query:
            agent: '@a/b'
`;
    const found = validateFlow(y).errors.filter((e) => e.code === 'atlas_prompt_missing');
    expect(found).toHaveLength(1);
    expect(found[0]!.stepId).toBe('s.body');
    expect(found[0]!.field).toBe('steps.s.loop.steps[0]');
  });
});
