// 0.35.0: atlas_skills_not_literal. On an agent run, query.skills picks which of
// the organization's templates the run starts with, so no entry may be computed
// from a template; on a capability step `skills` is an ordinary tool argument.

import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';

const flow = (executor: string, query: string): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: only
steps:
  only:
    executor: ${executor}
    query:
${query}`;

const loopFlow = (query: string): string => `aigentflow_version: "2.0.0"
name: test-flow
version: 1.0.0
start: spin
steps:
  spin:
    loop:
      while: '{{ lt .loop.index 2 }}'
      max_iterations: 2
      steps:
        - id: run
          executor: nexus://agent/run
          query:
${query}
    next:
      default: 'null'
`;

const AGENT = "      agent: '@a/b'\n      prompt: hi\n";
const CODE = 'atlas_skills_not_literal';
const MESSAGE =
  'step "only": every `skills` entry must be a literal, not a template. They choose which of the organization\'s templates the person\'s agent run starts with, so they are never rendered from inputs or outside data';
const SUGGESTION = "Write the agent's name literally; to run different agents, use different steps";

const skillFindings = (y: string) => validateFlow(y).errors.filter((e) => e.code === CODE);

describe('atlas_skills_not_literal', () => {
  it('refuses a templated string entry, addressed to the step, with the reference text', () => {
    const r = validateFlow(
      flow(
        'nexus://agent/run',
        `${AGENT}      skills:\n        - '@a/s'\n        - '{{ .query.skill }}'\n`,
      ),
    );
    expect(r.valid).toBe(false);
    const found = r.errors.filter((e) => e.code === CODE);
    expect(found).toHaveLength(1);
    expect(found[0]!.field).toBe('steps.only');
    expect(found[0]!.stepId).toBe('only');
    expect(found[0]!.message).toBe(MESSAGE);
    expect(found[0]!.suggestion).toBe(SUGGESTION);
  });

  it.each([
    ['ref', "        - ref: '{{ .query.r }}'\n"],
    ['version', "        - ref: '@a/t'\n          version: '{{ .query.v }}'\n"],
    ['a templated scalar', "      skills: '{{ toJson .query.s }}'\n"],
  ])('refuses a template in %s', (_name, skills) => {
    const query = skills.startsWith('      skills')
      ? `${AGENT}${skills}`
      : `${AGENT}      skills:\n${skills}`;
    expect(skillFindings(flow('nexus://agent/run', query))).toHaveLength(1);
  });

  it('applies to the atlas:// alias spelling', () => {
    expect(
      skillFindings(flow('atlas://agent/run', `${AGENT}      skills: ['{{ .query.s }}']\n`)),
    ).toHaveLength(1);
  });

  it('is an error in a loop body, addressed to the sub-step', () => {
    const r = validateFlow(
      loopFlow(
        "            agent: '@a/b'\n            prompt: hi\n            skills: ['{{ .query.s }}']",
      ),
    );
    const found = r.errors.filter((e) => e.code === CODE);
    expect(found).toHaveLength(1);
    expect(found[0]!.field).toBe('steps.spin.loop.steps[0]');
    expect(r.warnings.some((w) => w.code === CODE)).toBe(false);
  });

  it.each([
    [
      'literal skills, an object with a version included',
      'nexus://agent/run',
      `${AGENT}      skills:\n        - '@a/s'\n        - ref: '@a/t'\n          version: '1.2.0'\n`,
    ],
    [
      'templated files on an agent run',
      'nexus://agent/run',
      `${AGENT}      files: '{{ toJson .data.d.files }}'\n`,
    ],
    [
      "a capability's skills argument",
      'nexus://capability/web_search',
      "      skills: '{{ .query.s }}'\n",
    ],
    [
      "a capability's files argument",
      'nexus://capability/web_search',
      "      files: '{{ .query.f }}'\n",
    ],
  ])('does not fire on %s', (_name, executor, query) => {
    const r = validateFlow(flow(executor, query));
    expect(r.errors.concat(r.warnings).some((e) => e.code === CODE)).toBe(false);
  });
});
