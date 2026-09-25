import { describe, expect, it } from 'vitest';
import { validateFlow, validateFlowObject, type ValidationResult } from '../src/index.js';
import { parseGoDuration } from '../src/validators/util.js';

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

// v2.608.0 — the branch-target key. This validator read `goto_step` here for its
// whole life, which is the spelling used by error_strategy and quality_gate and
// the WRONG one for a condition (aigentflow.domain.step.go:134 carries
// `yaml:"goto"`). Two silent consequences, both of which these cases pin:
// a typo'd branch target was never reported, and every conditionally-reached step
// was accused of being unreachable. The old fixtures used `goto_step`, so 105
// tests were green over the defect.
describe('conditional branch targets', () => {
  const BRANCHING = {
    ...MINIMAL,
    steps: {
      a: {
        executor: 'mock://x/y',
        next: { default: 'null', conditions: [{ if: '{{ true }}', goto: 'b' }] },
      },
      b: { executor: 'mock://x/y', next: { default: 'null' } },
    },
  };

  it('reports a conditional branch target that does not exist', () => {
    const r = validateFlowObject({
      ...BRANCHING,
      steps: {
        ...BRANCHING.steps,
        a: {
          ...BRANCHING.steps.a,
          next: { default: 'null', conditions: [{ if: '{{ true }}', goto: 'nope' }] },
        },
      },
    });
    expect(codes(r)).toContain('step_not_found');
  });

  it('does NOT accuse a conditionally-reached step of being unreachable', () => {
    const r = validateFlowObject(BRANCHING);
    expect(warnCodes(r)).not.toContain('unreachable_step');
  });

  it("rejects the 'goto_step' spelling inside a condition", () => {
    const r = validateFlowObject({
      ...BRANCHING,
      steps: {
        ...BRANCHING.steps,
        a: {
          ...BRANCHING.steps.a,
          next: { default: 'null', conditions: [{ if: '{{ true }}', goto_step: 'b' }] },
        },
      },
    });
    expect(codes(r)).toContain('unknown_yaml_key');
    expect(r.valid).toBe(false);
  });
});

// v2.608.0 — reachability follows five edge kinds plus the flow-level error
// redirect; cycles deliberately still follow two. See connectivity.ts.
describe('reachability edge kinds', () => {
  const via = (stepA: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    ...MINIMAL,
    ...extra,
    steps: { a: { executor: 'mock://x/y', ...stepA }, b: { executor: 'mock://x/y' } },
  });

  it.each([
    ['next.parallel.steps', via({ next: { parallel: { steps: ['b'] } } })],
    ['next.parallel.rendezvous', via({ next: { parallel: { steps: [], rendezvous: 'b' } } })],
    ['step error_strategy.goto_step', via({ error_strategy: { action: 'goto', goto_step: 'b' } })],
    [
      'flow error_strategy.goto_step',
      via({}, { error_strategy: { action: 'goto', goto_step: 'b' } }),
    ],
  ])('reaches a step through %s', (_label, flow) => {
    const r = validateFlowObject(flow);
    expect(warnCodes(r)).not.toContain('unreachable_step');
  });

  it('still reports a genuinely orphaned step', () => {
    const r = validateFlowObject(via({}));
    expect(warnCodes(r)).toContain('unreachable_step');
  });

  it('does not call a rendezvous loop-back an infinite loop', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: { executor: 'mock://x/y', next: { parallel: { steps: ['b'], rendezvous: 'a' } } },
        b: { executor: 'mock://x/y' },
      },
    });
    expect(warnCodes(r)).not.toContain('potential_infinite_loop');
  });
});

describe('executors', () => {
  it('errors on a malformed executor URI', () => {
    const r = validateFlowObject({ ...MINIMAL, steps: { a: { executor: 'nope' } } });
    expect(codes(r)).toContain('invalid_executor_url');
  });
  // v2.608.0 — the shape check is now AIgentFlow's ONE parser (URL_PATTERN_REGEX),
  // not a loose `scheme://path` test. Each of these SAVED here and is refused by
  // AIgentFlow at create, which is a false pass in the worst direction.
  it.each([
    ['openai:///gpt-4', 'empty authority'],
    ['ai://openai', 'no path segment'],
    ['http://api.example.com/v1', 'dots in the authority'],
    ['ai://openai/chat!', 'a character outside the parser class'],
    ['ai://open ai/chat', 'a space'],
  ])('rejects %s (%s)', (executor) => {
    const r = validateFlowObject({ ...MINIMAL, steps: { a: { executor } } });
    expect(codes(r)).toContain('invalid_executor_url');
  });

  it('accepts a templated executor URL, which the engine renders before dispatch', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: { a: { executor: 'flow://stored/{{ .query.child_flow_id }}' } },
    });
    expect(codes(r)).not.toContain('invalid_executor_url');
  });

  it('checks a loop sub-step executor too (AIgentFlow DC-FORGE-38)', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: {
          loop: {
            while: '{{ lt .loop.index 2 }}',
            max_iterations: 2,
            steps: [{ id: 'work', executor: 'openai:///gpt-4' }],
          },
        },
      },
    });
    expect(codes(r)).toContain('invalid_executor_url');
  });

  // v2.608.0 — the vendored scheme set is now AIgentFlow's registered set exactly
  // (43 protocols, `NewExecutorSchemaRegistry`). `web://` was missing, so a correct
  // step warned; nine schemes AIgentFlow does not register (openai, anthropic,
  // perplexity, vertexai, ollama, vllm, aigentchat, external, https — legacy names
  // banner-marked non-functional in v2.596.0) were listed, so this validator stayed
  // silent where AIgentFlow fails at dispatch.
  it('does not warn on web://, which AIgentFlow registers', () => {
    const r = validateFlowObject({ ...MINIMAL, steps: { a: { executor: 'web://fetch/page' } } });
    expect(warnCodes(r)).not.toContain('unknown_executor_scheme');
  });

  it.each([
    'openai',
    'anthropic',
    'perplexity',
    'vertexai',
    'ollama',
    'vllm',
    'aigentchat',
    'external',
    'https',
  ])('warns on %s://, which AIgentFlow does not register', (scheme) => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: { a: { executor: `${scheme}://provider/op` } },
    });
    expect(warnCodes(r)).toContain('unknown_executor_scheme');
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
  it('warns when no response_evaluation reads the expectation (DC-FORGE-145)', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: { a: { executor: 'mock://x/y', response_expectation: { f: { type: 'string' } } } },
    });
    expect(r.valid).toBe(true);
    const w = r.warnings.find((x) => x.code === 'response_expectation_unread');
    expect(w?.field).toBe('steps.a.response_expectation');
    expect(w?.stepId).toBe('a');
    // Byte-identical to the reference's WARN_MSG_RESPONSE_EXPECTATION_UNREAD with %q.
    expect(w?.message).toBe(
      'response_expectation on step "a" is never checked: the engine reads it only when response_evaluation is set, and this step sets none, so required, type and fallback do nothing. Add response_evaluation: "raw-text" to check these fields against the executor\'s response unchanged, or remove response_expectation.',
    );
  });
  it('does not warn when an evaluation mode is set, on async://, or on an empty expectation', () => {
    const re = { f: { type: 'string' } };
    for (const step of [
      { executor: 'mock://x/y', response_evaluation: 'raw-text', response_expectation: re },
      {
        executor: 'mock://x/y',
        response_evaluation: 'markdown-json-block',
        response_expectation: re,
      },
      { executor: 'async://human/approve', response_expectation: re },
      { executor: 'mock://x/y', response_expectation: {} },
      { executor: 'mock://x/y' },
    ]) {
      const r = validateFlowObject({ ...MINIMAL, steps: { a: step } });
      expect(warnCodes(r), JSON.stringify(step)).not.toContain('response_expectation_unread');
    }
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
  it('accepts a single-key entry naming a catalog function', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      expression_functions: [{ function: 'fn_slugify' }],
    });
    expect(codes(r)).not.toContain('invalid_expression_function');
    expect(r.valid).toBe(true);
  });
  it('is structurally well-formed but refused when it names a package', () => {
    const r = validateFlowObject({ ...MINIMAL, expression_functions: [{ package: 'p' }] });
    expect(codes(r)).not.toContain('invalid_expression_function');
    expect(codes(r)).toContain('expression_function_package_unsupported');
  });
  it('refuses a function name outside the catalog', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      expression_functions: [{ function: 'fn_not_a_real_one' }],
    });
    expect(codes(r)).toContain('expression_function_unknown');
  });
  it('declaring a catalog function without using it is fine', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      expression_functions: [{ function: 'fn_round' }],
    });
    expect(r.valid).toBe(true);
  });
});

describe('expression_functions usage', () => {
  const withQuery = (value: string, declared?: string[]) => ({
    ...MINIMAL,
    ...(declared ? { expression_functions: declared.map((f) => ({ function: f })) } : {}),
    steps: { a: { executor: 'mock://x/y', query: { v: value } } },
  });

  it('accepts a declared catalog function', () => {
    const r = validateFlowObject(withQuery('{{ fn_slugify .query.name }}', ['fn_slugify']));
    expect(r.valid).toBe(true);
  });
  it('refuses a catalog function the flow does not declare', () => {
    const r = validateFlowObject(withQuery('{{ fn_slugify .query.name }}'));
    expect(codes(r)).toContain('expression_function_undeclared_use');
  });
  it('refuses an fn_ name that is not in the catalog at all', () => {
    const r = validateFlowObject(withQuery('{{ fn_slugfy .query.name }}', ['fn_slugify']));
    expect(codes(r)).toContain('expression_function_unknown_use');
    expect(codes(r)).not.toContain('expression_function_undeclared_use');
  });
  it('does NOT flag an fn_ name mentioned in prose outside a template action', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      description: 'This flow would benefit from fn_slugify one day.',
      steps: {
        a: {
          executor: 'mock://x/y',
          description: 'fn_round is not called here',
          query: { v: 'plain text mentioning fn_uniq' },
        },
      },
    });
    expect(r.valid).toBe(true);
  });
  it('scans a multi-line template action', () => {
    const r = validateFlowObject(withQuery('{{\n  fn_sha256\n    .query.name\n}}'));
    expect(codes(r)).toContain('expression_function_undeclared_use');
  });
  it('scans template strings outside steps (orchestrator prompts, output bindings)', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      output: ['{{ fn_uniq .data.a.items }}'],
    });
    expect(codes(r)).toContain('expression_function_undeclared_use');
  });
  // A `\b` before fn_ also matches between the DOT and the `f`, so a FIELD whose
  // name starts with fn_ looked like a call. That is a false refusal on a valid
  // flow, which is worse than a missed detection.
  it.each([
    ['a dotted data field', '{{ .data.fn_total }}'],
    ['a dotted step-response field', '{{ .step.response.fn_score }}'],
    ['a quoted data key', '{{ index .data "fn_result" }}'],
    ['a quoted dotted data key', '{{ index .data "step.fn_result" }}'],
    ['a backquoted data key', '{{ index .data `fn_result` }}'],
    ['a field whose name merely contains fn_', '{{ .data.step.xfn_total }}'],
  ])('does NOT read %s as a call', (_label, template) => {
    const r = validateFlowObject(withQuery(template));
    expect(codes(r).filter((c) => c.startsWith('expression_function'))).toEqual([]);
  });

  it('does NOT read a step NAMED fn_something as a call', () => {
    const r = validateFlowObject({
      aigentflow_version: '2.0.0',
      name: 'step-named-fn',
      start: 'fn_build',
      steps: {
        fn_build: {
          executor: 'mock://x/y',
          query: { v: '{{ .data.fn_build.value }}' },
          next: { default: 'end' },
        },
      },
    });
    expect(r.valid).toBe(true);
  });

  it('still catches a real call standing next to a same-named field', () => {
    const r = validateFlowObject(withQuery('{{ fn_sum .data.fn_sum }}'));
    expect(codes(r)).toContain('expression_function_undeclared_use');
  });

  it('still catches a call in a pipeline and inside parentheses', () => {
    const piped = validateFlowObject(withQuery('{{ .query.x | fn_slugify }}'));
    expect(codes(piped)).toContain('expression_function_undeclared_use');
    const parens = validateFlowObject(withQuery('{{ print (fn_sha256 .query.x) }}'));
    expect(codes(parens)).toContain('expression_function_undeclared_use');
  });

  it('reports one finding per distinct name, not per call site', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: { executor: 'mock://x/y', query: { v: '{{ fn_sum .a }}', w: '{{ fn_sum .b }}' } },
      },
    });
    expect(r.errors.filter((e) => e.code === 'expression_function_undeclared_use')).toHaveLength(1);
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
  it('accepts a loop sub-step next: that jumps forward and backward', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: {
          loop: {
            while: '{{ true }}',
            max_iterations: 3,
            steps: [
              { id: 's1', executor: 'mock://x/y', next: { default: 's3' } },
              { id: 's2', executor: 'mock://x/y', next: { default: '' } },
              {
                id: 's3',
                executor: 'mock://x/y',
                next: { conditions: [{ if: '{{ true }}', goto: 's1' }] },
              },
            ],
          },
        },
      },
    });
    expect(r.valid).toBe(true);
  });
  it('rejects a loop sub-step next: naming a TOP-LEVEL step', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: {
          loop: {
            while: '{{ true }}',
            max_iterations: 3,
            steps: [{ id: 's1', executor: 'mock://x/y', next: { default: 'b' } }],
          },
          next: { default: 'b' },
        },
        b: { executor: 'mock://x/y' },
      },
    });
    expect(codes(r)).toContain('loop_substep_next_target_not_found');
  });
  it('rejects the top-level next: sentinels inside a loop body', () => {
    for (const marker of ['null', 'orchestrator']) {
      const r = validateFlowObject({
        ...MINIMAL,
        steps: {
          a: {
            loop: {
              while: '{{ true }}',
              max_iterations: 3,
              steps: [{ id: 's1', executor: 'mock://x/y', next: { default: marker } }],
            },
          },
        },
      });
      expect(codes(r), marker).toContain('loop_substep_next_sentinel');
    }
  });
  it('reports `end` in a loop body as a missing target, not as a sentinel', () => {
    // Divergence #2 is about TOP-LEVEL targets. Inside a loop body nothing
    // reads `end`, and the reference refuses only `null`/`orchestrator` by name.
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: {
          loop: {
            while: '{{ true }}',
            max_iterations: 3,
            steps: [{ id: 's1', executor: 'mock://x/y', next: { default: 'end' } }],
          },
        },
      },
    });
    expect(codes(r)).toContain('loop_substep_next_target_not_found');
    expect(codes(r)).not.toContain('loop_substep_next_sentinel');
  });
  it('rejects next.parallel inside a loop body', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: {
          loop: {
            while: '{{ true }}',
            max_iterations: 3,
            steps: [
              {
                id: 's1',
                executor: 'mock://x/y',
                next: { parallel: { steps: ['s2'], rendezvous: 's2' } },
              },
              { id: 's2', executor: 'mock://x/y' },
            ],
          },
        },
      },
    });
    expect(codes(r)).toContain('loop_substep_next_parallel');
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

describe('processing-operation shape', () => {
  function opFlow(ops: unknown[], phase = 'post_processing') {
    return { ...MINIMAL, steps: { a: { executor: 'function://text/noop', [phase]: ops } } };
  }

  it('warns about an operation type the engine does not dispatch', () => {
    const r = validateFlowObject(opFlow([{ 'data.setx': { k: 'v' } }]));
    expect(warnCodes(r)).toContain('unknown_processing_operation');
    // The type is the YAML map key, so the finding addresses the operation
    // itself — there is no `operation_type` field to point an author at.
    const w = r.warnings.find((x) => x.code === 'unknown_processing_operation');
    expect(w?.field).toBe('steps.a.post_processing[0]');
    // One verdict per defect: an unknown type has no key set.
    expect(warnCodes(r)).not.toContain('unknown_processing_config_key');
  });

  it('treats loop.set and loop.break as undispatchable in a top-level step', () => {
    // Both are handled by a loop sub-step's post-processing before it delegates,
    // so they are legal there and nowhere else. A merged dispatch set would
    // silently accept them here.
    for (const type of ['loop.set', 'loop.break']) {
      const r = validateFlowObject(opFlow([{ [type]: { x: 1 } }]));
      expect(warnCodes(r), type).toContain('unknown_processing_operation');
    }
  });

  it('warns about a config key the operation does not read', () => {
    const r = validateFlowObject(opFlow([{ parse: { source: 's', onerror: 'continue' } }]));
    const w = r.warnings.filter((x) => x.code === 'unknown_processing_config_key');
    expect(w).toHaveLength(1);
    expect(w[0]?.field).toBe('steps.a.post_processing[0].onerror');
  });

  it('keeps the key sets per operation rather than unioning them', () => {
    // `asset_id` is genuinely read by binary.get/update/delete and is NOT read
    // by binary.transform, which reads source_asset_id. A union over the
    // operations accepts it — the failure mode is a name in the wrong half.
    const wrong = validateFlowObject(opFlow([{ 'binary.transform': { asset_id: 'x' } }]));
    expect(warnCodes(wrong)).toContain('unknown_processing_config_key');

    const right = validateFlowObject(opFlow([{ 'binary.get': { asset_id: 'x' } }]));
    expect(warnCodes(right)).not.toContain('unknown_processing_config_key');
  });

  it('says nothing about the keys of an open-key operation', () => {
    // data.set writes every key into `.data`, output.set into `.output`, and
    // conversation.append treats every key as a conversation id: the names are
    // the author's own, so "unknown key" is not a notion that applies.
    const r = validateFlowObject(
      opFlow([
        { 'data.set': { whatever: 1, another_invented_key: 2 } },
        { 'output.set': { some_output: 'v' } },
        { 'conversation.append': { my_convo: { role: 'user', content: 'hi' } } },
      ]),
    );
    expect(warnCodes(r)).not.toContain('unknown_processing_config_key');
    expect(warnCodes(r)).not.toContain('unknown_processing_operation');
  });

  it('does not read the `if:` guard as a config key', () => {
    // The guard is a sibling of the operation key, except on loop.break, where
    // `if` IS the config key.
    const r = validateFlowObject(
      opFlow([{ 'binary.delete': { asset_id: 'x' }, if: '{{ eq .query.go "yes" }}' }]),
    );
    expect(warnCodes(r)).not.toContain('unknown_processing_config_key');
  });

  it('checks pre_processing as well as post_processing', () => {
    const r = validateFlowObject(opFlow([{ 'data.setx': {} }], 'pre_processing'));
    const w = r.warnings.find((x) => x.code === 'unknown_processing_operation');
    expect(w?.field).toBe('steps.a.pre_processing[0]');
  });

  it('never turns either verdict into an error', () => {
    const r = validateFlowObject(
      opFlow([{ 'data.setx': {} }, { parse: { source: 's', onerror: 'x' } }]),
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });
});

describe('templates + summary', () => {
  // aigentflow v2.735.0 (DC-FORGE-162, aigentflow#149): Sprig's float names are
  // registered. Under strictRegistries an unknown function is an error, so this
  // is the only setting in which the allow-list is actually exercised.
  it('knows the Sprig float names under strictRegistries', () => {
    const r = validateFlowObject(
      {
        ...MINIMAL,
        steps: {
          a: {
            executor: 'function://text/noop',
            query: { v: '{{ divf (addf (mulf 2 0.5) 1) (float64 "2") }} {{ subf 3 1 }}' },
          },
        },
      },
      { strictRegistries: true },
    );
    expect(codes(r)).not.toContain('template_function_unknown');
    const control = validateFlowObject(
      {
        ...MINIMAL,
        steps: { a: { executor: 'function://text/noop', query: { v: '{{ addg 1 2 }}' } } },
      },
      { strictRegistries: true },
    );
    expect(codes(control)).toContain('template_function_unknown');
  });
  it('reports a template syntax error and counts templates', () => {
    const r = validateFlow(
      'aigentflow_version: "2.0.0"\nname: t\nstart: a\nsteps:\n  a:\n    executor: mock://x/y\n    query:\n      v: "{{ if .x }}oops"\n',
    );
    expect(codes(r)).toContain('template_syntax_error');
    expect(r.summary.templatesFound).toBe(1);
    expect(r.summary.templatesValid).toBe(0);
  });
  // DC-FORGE-76 (AIgentFlow v2.646.0): the reference absorbs a processing
  // operation's name into OperationType and its body into an inline Config, so
  // its field paths carry no operation segment. Pin the address, not just the
  // finding — this walker reported the same defect under a different one until
  // the reference had any address at all to agree with.
  it('addresses processing-operation templates the way the reference does', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: {
          executor: 'mock://x/y',
          pre_processing: [{ 'data.set': { prepped: '{{ if .x }}oops' } }],
          post_processing: [{ 'output.set': { done: '{{ if .y }}oops' }, if: '{{ if .z }}oops' }],
        },
      },
    });
    const fields = r.errors.filter((e) => e.code === 'template_syntax_error').map((e) => e.field);
    expect(fields).toContain('steps.a.pre_processing[0].prepped');
    expect(fields).toContain('steps.a.post_processing[0].done');
    expect(fields).toContain('steps.a.post_processing[0].if');
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

// DC-FORGE-78 — the loop body, and the three template functions the reference
// used in five of its own bundled flows while registering them nowhere.
describe('loop bodies (DC-FORGE-78)', () => {
  const loopFlow = (sub: Record<string, unknown>) => ({
    ...MINIMAL,
    start: 'looper',
    steps: {
      looper: {
        loop: { while: 'true', max_iterations: 3, vars: { n: '0' }, steps: [sub] },
      },
    },
  });

  it('walks every template site inside a loop sub-step', () => {
    // Each site SEPARATELY: one flow with one broken template would pass while
    // four sites stayed blind.
    const sites: Array<[string, Record<string, unknown>, string]> = [
      [
        'query',
        { id: 'b', executor: 'function://text/noop', query: { m: '{{ .x ' } },
        'loop.steps[0].query',
      ],
      [
        'condition',
        { id: 'b', executor: 'function://text/noop', condition: '{{ .x ' },
        'loop.steps[0].condition',
      ],
      [
        'pre_processing',
        {
          id: 'b',
          executor: 'function://text/noop',
          pre_processing: [{ 'data.set': { k: '{{ .x ' } }],
        },
        'loop.steps[0].pre_processing[0]',
      ],
      [
        'post_processing',
        {
          id: 'b',
          executor: 'function://text/noop',
          post_processing: [{ 'data.set': { k: '{{ .x ' } }],
        },
        'loop.steps[0].post_processing[0]',
      ],
      [
        'next.conditions',
        {
          id: 'b',
          executor: 'function://text/noop',
          next: { conditions: [{ if: '{{ .x ', goto: 'b' }] },
        },
        'loop.steps[0].next.conditions[0].if',
      ],
    ];
    for (const [name, sub, path] of sites) {
      const r = validateFlowObject(loopFlow(sub));
      expect(
        r.warnings.some((w) => w.field.includes(path)),
        `${name} must be walked`,
      ).toBe(true);
    }
  });

  it('never raises an ERROR from inside a loop body', () => {
    // ⛔ The reference consults this validator at its RUN door over flows stored
    // before the walk existed. The code survives the demotion; only severity
    // changes — dropping the finding would be worse than an error.
    const r = validateFlowObject(
      loopFlow({ id: 'b', executor: 'function://text/noop', query: { m: '{{ .x ' } }),
    );
    expect(r.valid).toBe(true);
    expect(r.errors.filter((e) => e.field.includes('loop.steps['))).toHaveLength(0);
    expect(warnCodes(r)).toContain('template_syntax_error');
  });

  it('dispatches loop.set / loop.break in a loop body and nowhere else', () => {
    for (const op of ['loop.set', 'loop.break']) {
      const inBody = validateFlowObject(
        loopFlow({
          id: 'b',
          executor: 'function://text/noop',
          post_processing: [{ [op]: { if: 'true' } }],
        }),
      );
      expect(warnCodes(inBody), `${op} is dispatchable on a loop sub-step`).not.toContain(
        'unknown_processing_operation',
      );

      const topLevel = validateFlowObject({
        ...MINIMAL,
        steps: {
          a: { executor: 'function://text/noop', post_processing: [{ [op]: { if: 'true' } }] },
        },
      });
      expect(warnCodes(topLevel), `${op} is NOT dispatchable at the top level`).toContain(
        'unknown_processing_operation',
      );
    }
  });

  it('knows atoi, mod and int — and still refuses an invented name', () => {
    // ⚠️ strictRegistries is what turns an unknown function into a finding, so a
    // fixture validated without it cannot say anything about the registry at
    // all. Five reference flows used these three while they existed NOWHERE.
    for (const expr of [
      '{{ atoi .loop.vars.n }}',
      '{{ mod .loop.vars.n 2 }}',
      '{{ int .query.t }}',
    ]) {
      const r = validateFlowObject(
        { ...MINIMAL, steps: { a: { executor: 'function://text/noop', query: { m: expr } } } },
        { strictRegistries: true },
      );
      expect(codes(r), `${expr} must be accepted`).not.toContain('template_function_unknown');
    }
    const invented = validateFlowObject(
      {
        ...MINIMAL,
        steps: { a: { executor: 'function://text/noop', query: { m: '{{ env.API_KEY }}' } } },
      },
      { strictRegistries: true },
    );
    // `env` is not and has never been a template function here — one bundled
    // reference flow used it in its `data:` block for the life of the repo.
    expect(codes(invented)).toContain('template_function_unknown');
  });
});

describe('step max_duration the engine cannot apply (AIF DC-FORGE-147)', () => {
  const unparseableMessage = (value: string, step: string): string =>
    `max_duration ${JSON.stringify(value)} on step ${JSON.stringify(step)} is not a duration, so the step runs with no time limit. Use a Go duration such as "90s", "5m" or "2h" (there is no day unit: write "48h", not "2d"; templates are not rendered here), or "none" for no limit.`;
  const loopMessage = (value: string, step: string): string =>
    `max_duration ${JSON.stringify(value)} on loop step ${JSON.stringify(step)} bounds nothing: a loop step makes no executor call of its own, and loop sub-steps have no max_duration key. Bound the loop with loop.max_iterations, or remove max_duration.`;
  const withStep = (step: Record<string, unknown>) => ({ ...MINIMAL, steps: { a: step } });
  const ignored = (r: ValidationResult) =>
    r.warnings.filter((w) => w.code === 'step_max_duration_ignored');

  it('agrees with Go time.ParseDuration on every value pinned here', () => {
    // Ground truth: `go run` of time.ParseDuration over exactly these strings.
    for (const [value, ok] of [
      ['90s', true],
      ['1h30m', true],
      ['500ms', true],
      ['-5s', true],
      ['0s', true],
      ['0', true],
      ['+0', true],
      ['+3m', true],
      ['1.s', true],
      ['.5s', true],
      ['1.5h', true],
      ['1us', true],
      ['1µs', true],
      ['1μs', true],
      ['1h1h', true],
      ['2562047h', true],
      ['2562048h', false],
      ['3000000h', false],
      ['2d', false],
      ['5 minutes', false],
      ['{{ .query.t }}', false],
      ['5', false],
      ['s', false],
      ['.s', false],
      ['5m ', false],
      ['1e3s', false],
      ['1_000s', false],
      ['-', false],
    ] as const) {
      expect(parseGoDuration(value) !== null, JSON.stringify(value)).toBe(ok);
    }
  });

  it('warns on each unparseable value, with the reference message verbatim', () => {
    for (const value of ['2d', '5 minutes', '{{ .query.timeout }}', '5']) {
      const r = validateFlowObject(withStep({ executor: 'mock://x/y', max_duration: value }));
      expect(r.valid).toBe(true);
      const w = ignored(r);
      expect(w, value).toHaveLength(1);
      expect(w[0]?.field).toBe('steps.a.max_duration');
      // The reference sets no StepID on this warning.
      expect(w[0]?.stepId).toBeUndefined();
      expect(w[0]?.message).toBe(unparseableMessage(value, 'a'));
    }
  });

  it('reads a YAML number as its text, as the reference string field does', () => {
    const r = validateFlow(
      'aigentflow_version: "2.0.0"\nname: n\nstart: a\nsteps:\n  a:\n    executor: mock://x/y\n    max_duration: 90\n',
    );
    expect(ignored(r)[0]?.message).toBe(unparseableMessage('90', 'a'));
  });

  it('warns on a valid max_duration on a loop step', () => {
    const r = validateFlowObject(
      withStep({
        max_duration: '5m',
        loop: {
          while: '{{ true }}',
          max_iterations: 2,
          steps: [{ id: 's', executor: 'mock://x/y' }],
        },
      }),
    );
    const w = ignored(r);
    expect(w).toHaveLength(1);
    expect(w[0]?.message).toBe(loopMessage('5m', 'a'));
  });

  it('reports an unparseable value on a loop step once, as unparseable', () => {
    const r = validateFlowObject(
      withStep({ max_duration: '2d', loop: { while: '{{ true }}', max_iterations: 2, steps: [] } }),
    );
    const w = ignored(r);
    expect(w).toHaveLength(1);
    expect(w[0]?.message).toBe(unparseableMessage('2d', 'a'));
  });

  it('does not warn on applied values, no-bound spellings, or an absent key', () => {
    for (const value of ['90s', '1h30m', '0s', '-5s', 'none', 'never', 'infinite', '', undefined]) {
      const step: Record<string, unknown> = { executor: 'mock://x/y' };
      if (value !== undefined) step.max_duration = value;
      const r = validateFlowObject(withStep(step));
      expect(warnCodes(r), String(value)).not.toContain('step_max_duration_ignored');
    }
  });

  it('does not walk the flow-level max_duration', () => {
    const r = validateFlowObject({ ...MINIMAL, max_duration: '2d' });
    expect(warnCodes(r)).not.toContain('step_max_duration_ignored');
  });
});

describe('retired limit keys (AIF DC-FORGE-150, v2.721.0)', () => {
  const retired = (r: ValidationResult) => r.errors.filter((e) => e.code === 'unknown_yaml_key');

  it('refuses a flow-level budget, whatever its value (0 and null included)', () => {
    for (const budget of [0.000001, 0, null, 'ten']) {
      const r = validateFlowObject({ ...MINIMAL, budget });
      expect(r.valid, `budget: ${String(budget)}`).toBe(false);
      const hits = retired(r);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.field).toBe('budget');
      expect(hits[0]?.message).toContain('v2.721.0');
      expect(hits[0]?.message).toContain('refuses to save');
      expect(hits[0]?.suggestion).toContain('billing: { max_credits: N }');
      expect(hits[0]?.suggestion).toContain('flow:// sub-flows are not checked');
    }
  });

  it('refuses a flow-level max_retries, 0 included', () => {
    for (const max_retries of [3, 0]) {
      const r = validateFlowObject({ ...MINIMAL, max_retries });
      const hits = retired(r);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.field).toBe('max_retries');
      expect(hits[0]?.suggestion).toContain('error_strategy: { action: "retry", max_retries: N }');
    }
  });

  it('refuses max_retries directly on a step, one finding per step', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: { executor: 'function://text/noop', max_retries: 0, next: { default: 'b' } },
        b: { executor: 'function://text/noop', max_retries: 3 },
      },
    });
    expect(retired(r).map((e) => [e.field, e.stepId])).toEqual([
      ['steps.a.max_retries', 'a'],
      ['steps.b.max_retries', 'b'],
    ]);
  });

  it('refuses max_retries on a loop sub-step (the reference type never had it)', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      steps: {
        a: {
          loop: {
            while: '{{ lt .loop.index 3 }}',
            max_iterations: 3,
            steps: [{ id: 'inner', executor: 'function://text/noop', max_retries: 2 }],
          },
        },
      },
    });
    expect(retired(r).map((e) => e.field)).toEqual(['steps.a.loop.steps[0].max_retries']);
  });

  it('never reports the working keys one level down', () => {
    const r = validateFlowObject({
      ...MINIMAL,
      currency: 'USD',
      max_duration: '10m',
      billing: { max_credits: 500 },
      error_strategy: { action: 'retry', max_retries: 2 },
      steps: {
        a: {
          executor: 'function://text/noop',
          error_strategy: { action: 'retry', max_retries: 0 },
          quality_gate: { rubric: 'ok', threshold: 0.5, on_fail: 'retry', max_retries: 1 },
          query: { budget: 5, max_retries: 4 },
        },
      },
    });
    expect(retired(r)).toHaveLength(0);
  });
});

describe('merge-train review fixes (AIF v2.695.0–v2.728.0)', () => {
  const orchFlow = (extra: Record<string, unknown>, campaign?: Record<string, unknown>) => ({
    ...MINIMAL,
    orchestrator: {
      mode: 'monitor',
      agentic: true,
      exons:
        '---\nname: monitor\ndescription: observe only\ntype: agent\nexecution:\n  provider: anthropic\n  model: m\n---\n{~exons.message role="system"~}observe{~/exons.message~}\n',
      ...extra,
    },
    ...(campaign ? { campaign } : {}),
  });

  it('treats an empty or null human_question_timeout as absent, like the reference', () => {
    for (const value of ['', null]) {
      const r = validateFlowObject(orchFlow({ human_question_timeout: value }));
      expect(codes(r), String(value)).not.toContain('orchestrator_human_question_timeout_invalid');
    }
    for (const value of ['0s', '-5m', '30', 'soon']) {
      const r = validateFlowObject(orchFlow({ human_question_timeout: value }));
      expect(codes(r), value).toContain('orchestrator_human_question_timeout_invalid');
    }
  });

  it('warns on a loop sub-step id that is one of the loop result summary fields', () => {
    for (const id of ['iterations', 'break', 'vars', 'duration_ms']) {
      const r = validateFlowObject({
        ...MINIMAL,
        start: 'looper',
        steps: {
          looper: {
            loop: {
              while: 'true',
              max_iterations: 2,
              steps: [{ id, executor: 'function://text/noop' }],
            },
          },
        },
      });
      expect(r.valid, id).toBe(true);
      const hit = r.warnings.find((w) => w.code === 'loop_sub_step_id_reserved');
      expect(hit?.field, id).toBe('steps.looper.loop.steps');
      expect(hit?.stepId, id).toBe('looper');
    }
    const clean = validateFlowObject({
      ...MINIMAL,
      start: 'looper',
      steps: {
        looper: {
          loop: {
            while: 'true',
            max_iterations: 2,
            steps: [{ id: 'iteration', executor: 'function://text/noop' }],
          },
        },
      },
    });
    expect(warnCodes(clean)).not.toContain('loop_sub_step_id_reserved');
  });

  it('refuses the retired campaign.budget_max_per_child, whatever its value', () => {
    for (const value of [1.0, 0, null]) {
      const r = validateFlowObject(
        orchFlow({}, { child_flows: [{ flow_name: 'x' }], budget_max_per_child: value }),
      );
      expect(
        r.errors.some(
          (e) => e.code === 'unknown_yaml_key' && e.field === 'campaign.budget_max_per_child',
        ),
        String(value),
      ).toBe(true);
    }
  });

  it('checks campaign.max_credits_per_child the way the reference decodes and validates it', () => {
    const run = (value: unknown) =>
      validateFlowObject(
        orchFlow({}, { child_flows: [{ flow_name: 'x' }], max_credits_per_child: value }),
      );
    for (const ok of [0, 500, null]) {
      const r = run(ok);
      expect(codes(r), String(ok)).not.toContain('campaign_invalid_max_credits_per_child');
      expect(
        r.errors.filter((e) => e.field === 'campaign.max_credits_per_child'),
        String(ok),
      ).toHaveLength(0);
    }
    expect(codes(run(-1))).toContain('campaign_invalid_max_credits_per_child');
    for (const bad of [1.5, '5']) {
      expect(
        run(bad).errors.some(
          (e) => e.code === 'invalid_type' && e.field === 'campaign.max_credits_per_child',
        ),
        String(bad),
      ).toBe(true);
    }
  });
});
