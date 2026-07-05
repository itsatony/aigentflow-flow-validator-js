import { describe, expect, it } from 'vitest';
import { validateFlow, validateFlowObject, type ValidationResult } from '../src/index.js';

function codes(r: ValidationResult): string[] {
  return r.errors.map((e) => e.code);
}
function warnCodes(r: ValidationResult): string[] {
  return r.warnings.map((w) => w.code);
}

const MINIMAL = {
  aigentflow_version: '2.0.0',
  name: 'minimal',
  start: 'a',
  steps: { a: { executor: 'function://text/noop' } },
};

describe('basic structure', () => {
  it('passes a minimal valid flow', () => {
    const r = validateFlowObject(MINIMAL);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.summary.totalSteps).toBe(1);
  });

  it('requires aigentflow_version, name, start, steps', () => {
    const r = validateFlowObject({});
    expect(codes(r).filter((c) => c === 'missing_required_field').length).toBeGreaterThanOrEqual(4);
  });

  it('flags a missing start step', () => {
    const r = validateFlowObject({ ...MINIMAL, start: 'nope' });
    expect(codes(r)).toContain('step_not_found');
  });

  it('requires an executor on non-loop steps', () => {
    const r = validateFlowObject({ ...MINIMAL, steps: { a: {} } });
    expect(codes(r)).toContain('missing_required_field');
  });

  it('rejects a "." in a step ID', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      start: 'a.b',
      steps: { 'a.b': { executor: 'mock://x/y' } },
    });
    expect(codes(r)).toContain('reserved_step_id_char');
  });
});

describe('executors', () => {
  it('errors on a malformed executor URI', () => {
    const r = validateFlowObject({ ...MINIMAL, steps: { a: { executor: 'nope' } } });
    expect(codes(r)).toContain('invalid_executor_url');
  });
  it('warns on an unknown scheme', () => {
    const r = validateFlowObject({ ...MINIMAL, steps: { a: { executor: 'bogus://x/y' } } });
    expect(warnCodes(r)).toContain('unknown_executor_scheme');
    expect(r.valid).toBe(true);
  });
  it('accepts a known scheme', () => {
    const r = validateFlowObject({ ...MINIMAL, steps: { a: { executor: 'ai://openai/chat' } } });
    expect(warnCodes(r)).not.toContain('unknown_executor_scheme');
  });
});

describe('query schema', () => {
  it('requires a type on each param', () => {
    const r = validateFlowObject({ ...MINIMAL, query: { p: {} } });
    expect(codes(r)).toContain('query_param_type_missing');
  });
  it('requires items on array params', () => {
    const r = validateFlowObject({ ...MINIMAL, query: { p: { type: 'array' } } });
    expect(codes(r)).toContain('array_items_missing');
  });
  it('validates array item types', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      query: { p: { type: 'array', items: { type: 'weird' } } },
    });
    expect(codes(r)).toContain('array_items_type_invalid');
  });
  it('rejects max_items < min_items', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      query: { p: { type: 'array', items: { type: 'string' }, min_items: 5, max_items: 2 } },
    });
    expect(codes(r)).toContain('array_max_items_invalid');
  });
});

describe('response_expectation', () => {
  it('rejects an invalid type', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: { a: { executor: 'mock://x/y', response_expectation: { f: { type: 'nope' } } } },
    });
    expect(codes(r)).toContain('invalid_data_type');
  });
  it('requires items on array fields', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: { a: { executor: 'mock://x/y', response_expectation: { f: { type: 'array' } } } },
    });
    expect(codes(r)).toContain('response_expectation_array_items_missing');
  });
});

describe('error_strategy', () => {
  it('rejects an unknown action', () => {
    const r = validateFlowObject({ ...MINIMAL, error_strategy: { action: 'explode' } });
    expect(codes(r)).toContain('invalid_error_strategy_action');
  });
  it('requires goto_step for goto', () => {
    const r = validateFlowObject({ ...MINIMAL, error_strategy: { action: 'goto' } });
    expect(codes(r)).toContain('goto_step_missing');
  });
  it('rejects an unknown goto target', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      error_strategy: { action: 'goto', goto_step: 'nope' },
    });
    expect(codes(r)).toContain('step_not_found');
  });
  it('rejects an invalid max_delay duration', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      error_strategy: { action: 'retry', max_delay: '5 fortnights' },
    });
    expect(codes(r)).toContain('invalid_duration');
  });
  it('accepts a valid Go duration', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      error_strategy: { action: 'retry', max_delay: '1m30s' },
    });
    expect(codes(r)).not.toContain('invalid_duration');
  });
  it('rejects an unknown retry_on category', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      error_strategy: { action: 'retry', retry_on: ['bogus'] },
    });
    expect(codes(r)).toContain('invalid_retry_on_category');
  });
});

describe('connectivity', () => {
  it('errors on a nonexistent next.default', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: { a: { executor: 'mock://x/y', next: { default: 'gone' } } },
    });
    expect(codes(r)).toContain('step_not_found');
  });
  it('treats end/null/orchestrator as terminal markers', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: { a: { executor: 'mock://x/y', next: { default: 'end' } } },
    });
    expect(r.valid).toBe(true);
  });
  it('warns about unreachable steps', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: { executor: 'mock://x/y', next: { default: 'end' } },
        orphan: { executor: 'mock://x/y' },
      },
    });
    expect(warnCodes(r)).toContain('unreachable_step');
  });
  it('warns about cycles', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: { a: { executor: 'mock://x/y', next: { default: 'a' } } },
    });
    expect(warnCodes(r)).toContain('potential_infinite_loop');
  });
});

describe('next.parallel + orchestrator-next', () => {
  it('requires rendezvous and steps', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: { a: { executor: 'mock://x/y', next: { parallel: {} } } },
    });
    expect(codes(r).filter((c) => c === 'missing_required_field').length).toBeGreaterThanOrEqual(2);
  });
  it('requires an orchestrator for orchestrator-next', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: { a: { executor: 'mock://x/y', next: { default: 'orchestrator' } } },
    });
    expect(codes(r)).toContain('orchestrator_next_requires_orchestrator');
  });
});

describe('expression_functions', () => {
  it('rejects an entry with both keys', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      expression_functions: [{ package: 'p', function: 'f' }],
    });
    expect(codes(r)).toContain('invalid_expression_function');
  });
  it('accepts a single-key entry', () => {
    const r = validateFlowObject({ ...MINIMAL, expression_functions: [{ package: 'p' }] });
    expect(codes(r)).not.toContain('invalid_expression_function');
  });
});

describe('loop / for_each / throttle', () => {
  it('validates a well-formed loop', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: {
          loop: {
            while: '{{ true }}',
            max_iterations: 3,
            steps: [{ id: 's1', executor: 'mock://x/y' }],
          },
        },
      },
    });
    expect(r.valid).toBe(true);
  });
  it('rejects a loop over the iteration limit', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: {
          loop: {
            while: 'x',
            max_iterations: 99999,
            steps: [{ id: 's1', executor: 'mock://x/y' }],
          },
        },
      },
    });
    expect(codes(r)).toContain('loop_max_iterations_range');
  });
  it('rejects for_each without items', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: { a: { executor: 'mock://x/y', for_each: {} } },
    });
    expect(codes(r)).toContain('for_each_items_required');
  });
  it('rejects a throttle delay over the maximum', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: { executor: 'mock://x/y', for_each: { items: '{{ .x }}', throttle: { delay: '10m' } } },
      },
    });
    expect(codes(r)).toContain('throttle_delay_exceeds_max');
  });
});

describe('orchestrator / campaign', () => {
  it('requires exons and validates triggers/tools', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      orchestrator: { triggers: [{ type: 'bogus' }], tools: ['aif_not_real'] },
    });
    expect(codes(r)).toContain('orchestrator_exons_required');
    expect(codes(r)).toContain('orchestrator_trigger_unknown');
    expect(warnCodes(r)).toContain('orchestrator_tool_unknown');
  });
  it('escalates unknown tools to errors under strictRegistries', () => {
    const r = validateFlowObject(
      { ...MINIMAL, orchestrator: { exons: 'x', tools: ['aif_not_real'] } },
      { strictRegistries: true },
    );
    expect(codes(r)).toContain('orchestrator_tool_unknown');
  });
  it('requires an orchestrator for a campaign', () => {
    const r = validateFlowObject({ ...MINIMAL, campaign: { children: [] } });
    expect(codes(r)).toContain('campaign_requires_orchestrator');
  });
});

describe('credential bindings', () => {
  it('rejects both credential and credentials', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: {
          executor: 'mock://x/y',
          credential: 'stored/p/n',
          credentials: { k: { source: 'stored/p/n', inject_as: 'X' } },
        },
      },
    });
    expect(codes(r)).toContain('cred_bind_mutual_exclusive');
  });
  it('rejects a bad source format', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: { a: { executor: 'mock://x/y', credential: 'stored/onlyprovider' } },
    });
    expect(codes(r)).toContain('cred_bind_shorthand_format');
  });
  it('accepts a valid binding', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: {
          executor: 'mock://x/y',
          credentials: { k: { source: 'stored/openai/default', inject_as: 'OPENAI_API_KEY' } },
        },
      },
    });
    expect(r.valid).toBe(true);
  });
});

describe('input_schema', () => {
  it('rejects an unsupported version', () => {
    const r = validateFlowObject({ ...MINIMAL, input_schema: { version: 99, fields: [] } });
    expect(codes(r)).toContain('input_schema_invalid_version');
  });
  it('rejects an invalid field name', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      input_schema: { version: 1, fields: [{ name: 'Bad Name', type: 'string' }] },
    });
    expect(codes(r)).toContain('input_schema_invalid_field_name');
  });
  it('rejects an unknown field type', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      input_schema: { version: 1, fields: [{ name: 'x', type: 'wat' }] },
    });
    expect(codes(r)).toContain('input_schema_unknown_type');
  });
  it('rejects constraint/type mismatch', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      input_schema: { version: 1, fields: [{ name: 'x', type: 'bool', min_length: 3 }] },
    });
    expect(codes(r)).toContain('input_schema_constraint_type_mismatch');
  });
  it('rejects an unresolved visible_when reference', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      input_schema: {
        version: 1,
        fields: [{ name: 'x', type: 'string', visible_when: { field: 'ghost', equals: 'y' } }],
      },
    });
    expect(codes(r)).toContain('input_schema_visible_when_unknown_field');
  });
  it('warns about file fields after parametric fields', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      input_schema: {
        version: 1,
        fields: [
          { name: 'n', type: 'number' },
          { name: 'f', type: 'file' },
        ],
      },
    });
    expect(warnCodes(r)).toContain('input_schema_file_after_parametric');
  });
  it('accepts a well-formed input_schema', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      input_schema: {
        version: 1,
        fields: [{ name: 'topic', type: 'string', required: true, max_length: 200 }],
      },
    });
    expect(r.valid).toBe(true);
  });
});

describe('templates + summary', () => {
  it('reports a template syntax error and counts templates', () => {
    const r = validateFlow(
      'aigentflow_version: "2.0.0"\nname: t\nstart: a\nsteps:\n  a:\n    executor: mock://x/y\n    query:\n      v: "{{ if .x }}oops"\n',
    );
    expect(codes(r)).toContain('template_syntax_error');
    expect(r.summary.templatesFound).toBe(1);
    expect(r.summary.templatesValid).toBe(0);
  });
  it('counts a valid template as valid', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: { a: { executor: 'mock://x/y', query: { v: '{{ .query.name }}' } } },
    });
    expect(r.summary.templatesFound).toBe(1);
    expect(r.summary.templatesValid).toBe(1);
  });
});

describe('wait:// + eval:// executor schemes (CLEANER POWER Phase 2)', () => {
  it('accepts wait:// as a known scheme (no unknown-scheme warning)', () => {
    for (const url of ['wait://timer/30s', 'wait://timer/until', 'wait://event/approved']) {
      const r = validateFlowObject({ ...MINIMAL, steps: { a: { executor: url } } });
      expect(warnCodes(r), url).not.toContain('unknown_executor_scheme');
      expect(r.valid, url).toBe(true);
    }
  });
  it('accepts eval://judge/evaluate as a known scheme', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: { a: { executor: 'eval://judge/evaluate' } },
    });
    expect(warnCodes(r)).not.toContain('unknown_executor_scheme');
    expect(r.valid).toBe(true);
  });
  it('still errors on a malformed wait:// URI', () => {
    const r = validateFlowObject({ ...MINIMAL, steps: { a: { executor: 'wait://' } } });
    expect(codes(r)).toContain('invalid_executor_url');
  });
});

describe('step output_schema (DC-CP-7)', () => {
  const withOutput = (schema: unknown) => ({
    ...MINIMAL,
    steps: { a: { executor: 'ai://openai/chat', output_schema: schema } },
  });
  it('accepts a well-formed output_schema (same subset as input_schema)', () => {
    const r = validateFlowObject(
      withOutput({ version: 1, fields: [{ name: 'summary', type: 'string', required: true }] }),
    );
    expect(r.valid).toBe(true);
  });
  it('rejects a bad output_schema version', () => {
    const r = validateFlowObject(withOutput({ version: 2, fields: [] }));
    expect(codes(r)).toContain('input_schema_invalid_version');
  });
  it('reuses input-schema field rules (bad field name) at step scope', () => {
    const r = validateFlowObject(
      withOutput({ version: 1, fields: [{ name: 'NotSnake', type: 'string' }] }),
    );
    expect(codes(r)).toContain('input_schema_invalid_field_name');
    expect(r.errors.some((e) => e.field === 'steps.a.output_schema.fields[0]')).toBe(true);
  });
  it('validates output_schema on loop sub-steps', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: {
          loop: {
            while: '{{ lt .loop.index 3 }}',
            max_iterations: 5,
            steps: [{ id: 's', executor: 'mock://x/y', output_schema: { version: 9, fields: [] } }],
          },
        },
      },
    });
    expect(codes(r)).toContain('input_schema_invalid_version');
  });
});

describe('quality_gate block (DC-CP-8)', () => {
  const withGate = (gate: unknown, extra: Record<string, unknown> = {}) => ({
    ...MINIMAL,
    steps: {
      a: { executor: 'ai://openai/chat', quality_gate: gate, ...extra },
      b: { executor: 'mock://x/y' },
    },
  });
  it('accepts a well-formed quality_gate', () => {
    const r = validateFlowObject(
      withGate({ rubric: 'Be accurate.', threshold: 0.8, on_fail: 'retry', max_retries: 2 }),
    );
    expect(r.valid).toBe(true);
  });
  it('requires a rubric', () => {
    const r = validateFlowObject(withGate({ threshold: 0.5 }));
    expect(codes(r)).toContain('quality_gate_missing_rubric');
  });
  it('rejects a threshold out of [0,1]', () => {
    const r = validateFlowObject(withGate({ rubric: 'x', threshold: 1.5 }));
    expect(codes(r)).toContain('quality_gate_threshold_out_of_range');
  });
  it('rejects an unknown on_fail', () => {
    const r = validateFlowObject(withGate({ rubric: 'x', on_fail: 'bogus' }));
    expect(codes(r)).toContain('quality_gate_invalid_on_fail');
  });
  it('rejects on_fail=human (in the Go enum but not yet supported)', () => {
    const r = validateFlowObject(withGate({ rubric: 'x', on_fail: 'human' }));
    expect(codes(r)).toContain('quality_gate_on_fail_unsupported');
  });
  it('requires goto_step when on_fail=goto', () => {
    const r = validateFlowObject(withGate({ rubric: 'x', on_fail: 'goto' }));
    expect(codes(r)).toContain('quality_gate_goto_missing');
  });
  it('errors when goto_step does not exist', () => {
    const r = validateFlowObject(withGate({ rubric: 'x', on_fail: 'goto', goto_step: 'nope' }));
    expect(codes(r)).toContain('step_not_found');
  });
  it('accepts goto_step that exists', () => {
    const r = validateFlowObject(withGate({ rubric: 'x', on_fail: 'goto', goto_step: 'b' }));
    expect(r.valid).toBe(true);
  });
  it('rejects a self-goto', () => {
    const r = validateFlowObject(withGate({ rubric: 'x', on_fail: 'goto', goto_step: 'a' }));
    expect(codes(r)).toContain('quality_gate_goto_self');
  });
  it('rejects a gate on a composite (for_each) step', () => {
    const r = validateFlowObject(
      withGate({ rubric: 'x' }, { for_each: { items: '{{ .query.list }}', as: 'item' } }),
    );
    expect(codes(r)).toContain('quality_gate_on_composite');
  });
  it('rejects a gate on a parallel-member step', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      start: 'fan',
      steps: {
        fan: {
          executor: 'mock://x/y',
          next: { parallel: { steps: ['a'], resolution: 'all-complete' } },
        },
        a: { executor: 'ai://openai/chat', quality_gate: { rubric: 'x' } },
      },
    });
    expect(codes(r)).toContain('quality_gate_on_parallel_member');
  });
});
