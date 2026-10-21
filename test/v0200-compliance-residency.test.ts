// 0.20.0: AIgentFlow v2.821.0's `compliance_residency_unenforced` warning. An
// EU-only compliance.residency beside a literal call on a region-lane provider
// that nothing pins draws the warning; everything else is silent. The shared
// fixtures carry the headline cases; this matrix carries the shapes a fixture
// cannot (residency is flow-level, so each residency needs its own flow).

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';

const CODE = 'compliance_residency_unenforced';

interface Opts {
  residency?: string;
  stepExecutor?: string;
  stepQuery?: string;
  extra?: string;
  loopSub?: string;
}

function flow(o: Opts = {}): string {
  const residency = o.residency ?? "residency: ['EU']";
  const executor = o.stepExecutor ?? 'ai://openai/chat';
  const query = o.stepQuery ?? '';
  const body = o.loopSub
    ? `  work:
    loop:
      while: '{{ lt (atoi .loop.vars.counter) 2 }}'
      max_iterations: 3
      vars:
        counter: '0'
      steps:
${o.loopSub}
    next:
      default: 'null'`
    : `  work:
    executor: '${executor}'
    query:
      model: m
      prompt: hi
${query}
    next:
      default: 'null'`;
  return `aigentflow_version: '2.0.0'
name: t
version: '1.0.0'
compliance:
  ${residency}
${o.extra ?? ''}
start: work
steps:
${body}
`;
}

const warnings = (y: string) => validateFlow(y).warnings.filter((w) => w.code === CODE);

describe('compliance_residency_unenforced', () => {
  it('warns on an unpinned region-lane step, at the step executor, with the reference text', () => {
    const r = validateFlow(flow());
    const ws = r.warnings.filter((w) => w.code === CODE);
    expect(ws).toHaveLength(1);
    expect(r.valid).toBe(true);
    expect(ws[0]).toMatchObject({
      field: 'steps.work.executor',
      stepId: 'work',
      severity: 'warning',
    });
    expect(ws[0]?.message).toBe(
      'step "work" calls provider "openai", whose default endpoint commits to no jurisdiction, but sets neither region nor enforce_region, so nothing pins it to the declared residency [EU]. compliance.residency is a catalogue eligibility check, not endpoint evidence',
    );
  });

  it('names a loop sub-step by its id, with the top-level step as step id', () => {
    const y = flow({
      loopSub: `        - id: inner
          executor: ai://mistral/chat
          query: { model: m, prompt: hi }`,
    });
    const ws = warnings(y);
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ field: 'steps.work.loop.steps.inner.executor', stepId: 'work' });
    expect(ws[0]?.message).toContain(
      'loop sub-step "inner" of step "work" calls provider "mistral"',
    );
  });

  it('warns for every region-lane provider', () => {
    for (const p of [
      'bedrock',
      'google',
      'azure',
      'openai',
      'assemblyai',
      'speechmatics',
      'deepgram',
      'mistral',
    ]) {
      expect(warnings(flow({ stepExecutor: `ai://${p}/chat` })), p).toHaveLength(1);
    }
  });

  it('lower-cases the provider for the lane test but names it as written', () => {
    const ws = warnings(flow({ stepExecutor: 'ai://OpenAI/chat' }));
    expect(ws).toHaveLength(1);
    expect(ws[0]?.message).toContain('provider "OpenAI"');
  });

  it('is silent on providers with no region lane', () => {
    for (const p of ['anthropic', 'scaleway', 'vaiembed', 'ollama', 'unknownprovider']) {
      expect(warnings(flow({ stepExecutor: `ai://${p}/chat` })), p).toHaveLength(0);
    }
  });

  it('is silent for a templated, empty or slash-less provider and for non-ai executors', () => {
    for (const e of [
      'ai://{{ .query.p }}/chat',
      'ai:///chat',
      'ai://openai',
      'aiv://acme/helper',
      'function://utils/log',
      'AI://openai/chat',
    ]) {
      expect(warnings(flow({ stepExecutor: e })), e).toHaveLength(0);
    }
  });

  it('accepts every pin, and rejects the non-pins', () => {
    const pinned = [
      '      region: eu',
      '      enforce_region: true',
      '      enforce_region: "true"',
      '      enforce_region: "1"',
      '      enforce_region: "yes"',
      '      openai_base_url: https://x.example',
    ];
    for (const q of pinned) {
      expect(warnings(flow({ stepQuery: q })), q).toHaveLength(0);
    }
    const notPinned = [
      '      region: ""',
      '      region: "   "',
      '      region: 5',
      '      enforce_region: false',
      '      enforce_region: "no"',
      '      enforce_region: "True"',
      '      enforce_region: 1',
      '      openai_base_url: ""',
      '      mistral_base_url: https://x.example',
    ];
    for (const q of notPinned) {
      expect(warnings(flow({ stepQuery: q })), q).toHaveLength(1);
    }
  });

  it('reads executor_config.<provider>.base_url as a pin, for that provider only', () => {
    const cfg = (provider: string, url: string) =>
      `executor_config:\n  ${provider}:\n    base_url: '${url}'`;
    expect(warnings(flow({ extra: cfg('openai', 'https://x.example') }))).toHaveLength(0);
    expect(warnings(flow({ extra: cfg('openai', '  ') }))).toHaveLength(1);
    expect(warnings(flow({ extra: cfg('mistral', 'https://x.example') }))).toHaveLength(1);
  });

  it('applies only to an EU-only residency', () => {
    const cases: [string, number][] = [
      ["residency: ['EU']", 1],
      ["residency: ['eu']", 1],
      ["residency: [' DE ']", 1],
      ["residency: ['FR', 'IE', 'NL', 'IT', 'ES']", 1],
      ["residency: ['EU', 'US']", 0],
      ["residency: ['US']", 0],
      ["residency: ['EEA']", 0],
      ["residency: ['GB']", 0],
      ["residency: ['EU', '']", 0],
      ['residency: []', 0],
      ["max_retention: '30d'", 0],
    ];
    for (const [residency, n] of cases) {
      expect(warnings(flow({ residency })), residency).toHaveLength(n);
    }
  });

  it('is silent with no compliance block at all', () => {
    const y = flow().replace(/compliance:\n {2}residency: \['EU'\]\n/, '');
    expect(y).not.toContain('compliance');
    expect(warnings(y)).toHaveLength(0);
  });

  it('prints the residency as written, not normalised', () => {
    const ws = warnings(flow({ residency: "residency: ['eu', ' DE ']" }));
    expect(ws[0]?.message).toContain('residency [eu  DE ].');
  });

  it('has no orchestrator site (AIgentFlow v2.838.0): the block is orchestrator_removed', () => {
    const y =
      flow({ stepExecutor: 'ai://anthropic/chat' }) +
      'orchestrator:\n  exons: |\n    ---\n    name: o\n    execution:\n      provider: openai\n    ---\n    hi\n';
    expect(warnings(y)).toHaveLength(0);
  });
});
