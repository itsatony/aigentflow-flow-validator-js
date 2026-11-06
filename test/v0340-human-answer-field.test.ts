// 0.34.0 (AIgentFlow v2.878.0): human_answer_field. A human step's answer is
// committed as `response` (with `comments` and `timed_out`) and nothing else; a
// read under any other key renders "<no value>". The shared manifest
// test/conformance/human-answer-field-cases.json pins every finding's exact
// field, step, message and suggestion, as the reference produced them, and the
// Go port asserts the same table (validate_v0240_test.go).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';
import { HUMAN_ANSWER_FIELD, TEMPLATE_FUNCTIONS } from '../src/spec/index.js';
import { humanAnswerSteps } from '../src/validators/humanAnswer.js';
import { rootFieldChains } from '../src/template/gotmpl-fields.js';
import { checkGoTemplateSyntax } from '../src/template/gotmpl-syntax.js';
import type { Flow } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const conformanceDir = join(here, 'conformance');
const CODE = 'human_answer_field';

interface Finding {
  field: string;
  stepId: string;
  message: string;
  suggestion: string;
}

interface Manifest {
  flowTemplate: string;
  sites: string[];
  defaults: Record<string, string>;
  cases: (Record<string, unknown> & { name: string; findings: Finding[] })[];
}

const manifest = JSON.parse(
  readFileSync(join(conformanceDir, 'human-answer-field-cases.json'), 'utf8'),
) as Manifest;

function flowFor(c: Record<string, unknown>): string {
  let k = 0;
  return manifest.flowTemplate.replace(/%s/g, () => {
    const site = manifest.sites[k++] as string;
    const v =
      typeof c[site] === 'string' ? (c[site] as string) : (manifest.defaults[site] as string);
    return v.replace(/'/g, "''");
  });
}

describe('human_answer_field: the shared case table', () => {
  it('holds both sides', () => {
    expect(manifest.cases.some((c) => c.findings.length > 0)).toBe(true);
    expect(manifest.cases.some((c) => c.findings.length === 0)).toBe(true);
  });

  for (const c of manifest.cases) {
    it(c.name, () => {
      const result = validateFlow(flowFor(c));
      expect(result.errors.filter((e) => e.code === CODE)).toEqual([]);
      const got = result.warnings
        .filter((w) => w.code === CODE)
        .map((w) => ({
          field: w.field,
          stepId: w.stepId,
          message: w.message,
          suggestion: w.suggestion,
        }));
      expect(got).toEqual(c.findings);
    });
  }
});

describe('human_answer_field: a warning everywhere', () => {
  const files = [
    'warn-human-answer-field-post-processing.yaml',
    'warn-human-answer-field-next-condition.yaml',
    'warn-human-answer-field-data-read.yaml',
    'warn-human-answer-field-loop-substep.yaml',
  ];
  for (const file of files) {
    for (const opts of [{}, { storedBytes: true }, { strictRegistries: true }]) {
      it(`${file} ${JSON.stringify(opts)}`, () => {
        const yaml = readFileSync(join(conformanceDir, 'fixtures', file), 'utf8');
        const result = validateFlow(yaml, opts);
        expect(result.valid).toBe(true);
        expect(result.warnings.filter((w) => w.code === CODE)).toHaveLength(1);
      });
    }
  }
});

describe('human_answer_field: the spec block', () => {
  it('is the reference envelope', () => {
    expect(HUMAN_ANSWER_FIELD.code).toBe(CODE);
    expect([...HUMAN_ANSWER_FIELD.answerKeys]).toEqual(['response', 'comments', 'timed_out']);
    expect(HUMAN_ANSWER_FIELD.executorPrefix).toBe('async://human/');
    expect([...HUMAN_ANSWER_FIELD.nonParkingModes]).toEqual(['announce']);
  });
});

describe('humanAnswerSteps', () => {
  it("is the reference's AsyncHumanParkURL over top-level steps", () => {
    const flow = {
      steps: {
        a: { executor: 'async://human/prompt/text' },
        b: { executor: 'async://human/announce' },
        c: { executor: 'async://human/announce/x' },
        d: { executor: 'async://human/' },
        e: { executor: 'async://human//x' },
        f: { executor: 'async://external/rest/x' },
        g: { executor: 'ASYNC://human/prompt/text' },
        h: { loop: { steps: [{ id: 'x', executor: 'async://human/prompt/text' }] } },
      },
    } as unknown as Flow;
    expect([...humanAnswerSteps(flow)].sort()).toEqual(['a', 'e']);
  });
});

describe('rootFieldChains (the scanner the rule reads)', () => {
  const cases: [string, string[][]][] = [
    ['{{ .data.a.b }}', [['data', 'a', 'b']]],
    ['{{.data.a.b}}', [['data', 'a', 'b']]],
    ['{{ $.data.a.b }}{{ $x.data.a.b }}', []],
    ['{{ (.data).a.b }}', [['data']]],
    ['{{ add 1.5 .x.y }}', [['x', 'y']]],
    ['{{ ".data.a.b" }}{{ `.data.a.b` }}', []],
    ['{{ range .r }}{{ .data.a.b }}{{ else }}{{ .data.c.d }}{{ end }}{{ .z }}', [['r'], ['z']]],
    ['{{ with .w }}{{ .x }}{{ else with .v }}{{ .y }}{{ end }}', [['w']]],
    [
      '{{ if .i }}{{ .x }}{{ else if .j }}{{ .y }}{{ else }}{{ .z }}{{ end }}',
      [['i'], ['x'], ['j'], ['y'], ['z']],
    ],
    ['{{ if .i }}x{{ else with .v }}y{{ end }}', []],
    ['{{ range .r }}x{{ else if .j }}y{{ end }}', []],
    ['{{ define "t" }}{{ .x }}{{ end }}{{ template "t" .y }}', [['x'], ['y']]],
    ['{{ block "b" .y }}{{ .x }}{{ end }}', [['y'], ['x']]],
    ['{{ $v := .x.y }}{{ range $i, $e := .l }}{{ end }}', [['x', 'y'], ['l']]],
    ['{{ .x.y.z.w | upper }}', [['x', 'y', 'z', 'w']]],
    ['{{ .data.a.inhalt_ä }}', [['data', 'a', 'inhalt_ä']]],
    ['{{/* .data.a.b */}}', []],
  ];
  for (const [src, want] of cases) {
    it(src, () => {
      expect(rootFieldChains(src)).toEqual(want);
    });
  }
});

describe('break and continue are keywords, not functions', () => {
  it('raise no template_function_unknown', () => {
    const src = '{{ range .l }}{{ if . }}{{ break }}{{ end }}{{ continue }}{{ end }}';
    expect(
      checkGoTemplateSyntax(src, { knownFunctions: TEMPLATE_FUNCTIONS, strictFunctions: true }),
    ).toEqual([]);
  });
});
