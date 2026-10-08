// The `examples:` block: one fixture per code (a table mirroring the
// reference's), the FALSE-POSITIVE half (a flow that is all correct must raise
// nothing, and ordinary text must not read as a credential), and the narrowed
// input check. The shape each case is built from is the clean fixture on disk,
// so the conformance corpus and this table cannot drift apart.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFlow, validateFlow, validateFlowObject } from '../src/index.js';
import type { ValidationIssue } from '../src/index.js';
import { EXAMPLES } from '../src/spec/index.js';
import { applyExamplePatch } from '../src/validators/examples.js';

const here = dirname(fileURLToPath(import.meta.url));
const BASE_YAML = readFileSync(join(here, 'conformance/fixtures/examples-valid-base.yaml'), 'utf8');

// biome-ignore lint: a document under test is arbitrary
type Doc = any;

function base(): Doc {
  const out = parseFlow(BASE_YAML);
  if (out.flow === undefined) throw new Error('the clean fixture must parse');
  return out.flow;
}

function exampleIssues(flow: Doc): ValidationIssue[] {
  const r = validateFlowObject(flow);
  return [...r.errors, ...r.warnings].filter((i) => /^examples?_/.test(i.code));
}

const sha = 'a'.repeat(64);
const longString = (n: number): string => 'x'.repeat(n);
const ex = (f: Doc): Doc => f.examples[0];

type Row = [
  name: string,
  mutate: (f: Doc) => void,
  code: string,
  severity: 'error' | 'warning',
  field: string,
  message?: string,
];

const ROWS: Row[] = [
  [
    'too many examples',
    (f) => {
      for (let i = 0; i < EXAMPLES.limits.maxPerFlow; i++) {
        f.examples.push({ ...ex(f), id: `case_${String(i).padStart(2, '0')}` });
      }
    },
    'examples_too_many',
    'error',
    'examples',
    'flow declares 51 examples; the limit is 50',
  ],
  [
    'block too large',
    (f) => {
      f.examples = Array.from({ length: 12 }, (_, i) => ({
        ...ex(f),
        id: `bulk_${String(i).padStart(2, '0')}`,
        guidance: longString(1900),
        notes: longString(1900),
        input: { invoice_text: longString(19000) },
        expected: { rubric: longString(3900) },
      }));
    },
    'examples_block_too_large',
    'error',
    'examples',
  ],
  [
    'id missing',
    (f) => {
      delete ex(f).id;
    },
    'example_id_missing',
    'error',
    'examples[0].id',
    'example #1 has no id',
  ],
  [
    'id invalid',
    (f) => {
      ex(f).id = 'Bad-ID';
    },
    'example_id_invalid',
    'error',
    'examples[0].id',
    'example id "Bad-ID" is not valid: use lower-case letters, digits and underscores, starting with a letter (2 to 48 characters)',
  ],
  [
    'id slash excluded',
    (f) => {
      ex(f).id = 'a/b';
    },
    'example_id_invalid',
    'error',
    'examples[0].id',
  ],
  [
    'id duplicate',
    (f) => {
      f.examples.push({ ...ex(f) });
    },
    'example_id_duplicate',
    'error',
    'examples[1].id',
    'example id "standard_eur_invoice" is used by examples #1 and #2',
  ],
  [
    'title missing',
    (f) => {
      ex(f).title = '  ';
    },
    'example_title_missing',
    'error',
    'examples[0].title',
    'example "standard_eur_invoice" has no title; the title is what a person sees in the list of examples',
  ],
  [
    'title too long',
    (f) => {
      ex(f).title = longString(81);
    },
    'example_title_too_long',
    'error',
    'examples[0].title',
    'example "standard_eur_invoice" title is 81 characters; the limit is 80',
  ],
  [
    'guidance too long',
    (f) => {
      ex(f).guidance = longString(2001);
    },
    'example_guidance_too_long',
    'error',
    'examples[0].guidance',
  ],
  [
    'guidance missing',
    (f) => {
      delete ex(f).guidance;
    },
    'example_guidance_missing',
    'warning',
    'examples[0].guidance',
    'example "standard_eur_invoice" has no guidance. One sentence on why this case matters helps the judge and the next author.',
  ],
  [
    'notes too long',
    (f) => {
      ex(f).notes = longString(2001);
    },
    'example_notes_too_long',
    'error',
    'examples[0].notes',
  ],
  [
    'tag invalid',
    (f) => {
      ex(f).tags = ['Happy Path'];
    },
    'example_tag_invalid',
    'error',
    'examples[0].tags[0]',
    'example "standard_eur_invoice" has an invalid tag "Happy Path"',
  ],
  [
    'tag duplicate',
    (f) => {
      ex(f).tags = ['a', 'a'];
    },
    'example_tag_invalid',
    'error',
    'examples[0].tags[1]',
    'example "standard_eur_invoice" lists the tag "a" more than once',
  ],
  [
    'too many tags',
    (f) => {
      ex(f).tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    },
    'example_tag_invalid',
    'error',
    'examples[0].tags',
    'example "standard_eur_invoice" has 9 tags; the limit is 8',
  ],
  [
    'weight zero',
    (f) => {
      ex(f).weight = 0;
    },
    'example_weight_range',
    'error',
    'examples[0].weight',
    'example "standard_eur_invoice" has weight 0; use a number above 0 and at most 10',
  ],
  [
    'weight too big',
    (f) => {
      ex(f).weight = 10.5;
    },
    'example_weight_range',
    'error',
    'examples[0].weight',
    'example "standard_eur_invoice" has weight 10.5; use a number above 0 and at most 10',
  ],
  [
    'hold_out on a public flow',
    (f) => {
      f.visibility = 'public';
      ex(f).hold_out = true;
    },
    'example_holdout_in_public_flow',
    'error',
    'examples[0].hold_out',
    `example "standard_eur_invoice" is held out but this flow is public: a held-out example must stay private, and a public flow's definition is readable by everyone. Make the flow private or remove hold_out.`,
  ],
  [
    'input and input_ref',
    (f) => {
      ex(f).input_ref = { url: 'https://docs.example.org/in.json', sha256: sha };
    },
    'example_input_conflict',
    'error',
    'examples[0]',
    'example "standard_eur_invoice" sets both input and input_ref; use exactly one',
  ],
  [
    'neither input',
    (f) => {
      delete ex(f).input;
    },
    'example_input_missing',
    'error',
    'examples[0]',
    'example "standard_eur_invoice" has neither input nor input_ref; use input: {} for a flow that takes no input',
  ],
  [
    'input too large',
    (f) => {
      ex(f).input = { invoice_text: longString(EXAMPLES.limits.maxInlineInputBytes + 1) };
    },
    'example_input_too_large',
    'error',
    'examples[0].input',
  ],
  [
    'input type error',
    (f) => {
      ex(f).input = { invoice_text: 42 };
    },
    'example_input_invalid',
    'error',
    'examples[0].input.invoice_text',
    'example "standard_eur_invoice": input field "invoice_text" is not a valid string',
  ],
  [
    'input unknown field',
    (f) => {
      ex(f).input = { invoice_text: 'x', nope: 'y' };
    },
    'example_input_invalid',
    'error',
    'examples[0].input.nope',
    'example "standard_eur_invoice": input field "nope" is not declared in input_schema',
  ],
  [
    'input required missing',
    (f) => {
      ex(f).input = {};
    },
    'example_input_invalid',
    'error',
    'examples[0].input.invoice_text',
    'example "standard_eur_invoice": input field "invoice_text" is required',
  ],
  [
    'input enum violation',
    (f) => {
      ex(f).input = { invoice_text: 'x', currency_hint: 'GBP' };
    },
    'example_input_invalid',
    'error',
    'examples[0].input.currency_hint',
    'example "standard_eur_invoice": input field "currency_hint" value "GBP" is not one of [EUR,USD,CHF]',
  ],
  [
    'input unvalidated',
    (f) => {
      delete f.input_schema;
    },
    'example_input_unvalidated',
    'warning',
    'examples[0].input',
    'example "standard_eur_invoice" cannot be checked: the flow declares no input_schema and no query parameters.',
  ],
  [
    'input undeclared query',
    (f) => {
      delete f.input_schema;
      f.query = { topic: { type: 'string' } };
    },
    'example_input_invalid',
    'error',
    'examples[0].input.currency_hint',
    'example "standard_eur_invoice": "currency_hint" is not a declared input of this flow (declared: topic)',
  ],
  [
    'file given as slot id',
    (f) => {
      ex(f).input = { invoice_text: 'x', scan: 'slot_123' };
    },
    'example_file_input_needs_ref',
    'error',
    'examples[0].input.scan',
    'example "standard_eur_invoice": field "scan" is a file; give it as {url: "https://…"}. A pasted upload id would stop working as soon as the session ends.',
  ],
  [
    'secret value',
    (f) => {
      ex(f).input = { invoice_text: 'x', crm_token: 'plain-value' };
    },
    'example_secret_value',
    'error',
    'examples[0].input.crm_token',
    'example "standard_eur_invoice" gives a value for "crm_token", which is a secret field. Examples are saved inside the flow and are never allowed to hold secrets; remove it. The person running the evaluation is asked for it at run time.',
  ],
  [
    'secret-like value',
    (f) => {
      ex(f).guidance = `use the key sk-${'a'.repeat(24)}`;
    },
    'example_secret_like_value',
    'error',
    'examples[0].guidance',
    'examples[0].guidance looks like a credential (an API key). Examples are saved in the flow definition and must never contain keys or tokens. Replace it with a made-up value.',
  ],
  [
    'ref scheme http',
    (f) => {
      ex(f).input = { invoice_text: 'x', scan: { url: 'http://docs.example.org/a.pdf' } };
    },
    'example_ref_scheme',
    'error',
    'examples[0].input.scan',
    'only https:// references are allowed (got "http")',
  ],
  [
    'ref scheme reserved',
    (f) => {
      ex(f).input = { invoice_text: 'x', scan: { url: 'artifact:abc123' } };
    },
    'example_ref_scheme_reserved',
    'error',
    'examples[0].input.scan',
    'artifact: references are not available yet. Use an https URL, or paste the text into the example.',
  ],
  [
    'ref userinfo',
    (f) => {
      delete ex(f).input;
      ex(f).input_ref = { url: 'https://user:pw@docs.example.org/a.json', sha256: sha };
    },
    'example_ref_invalid',
    'error',
    'examples[0].input_ref',
    'a reference must not carry a login or a fragment',
  ],
  [
    'ref fragment',
    (f) => {
      delete ex(f).input;
      ex(f).input_ref = { url: 'https://docs.example.org/a.json#top', sha256: sha };
    },
    'example_ref_invalid',
    'error',
    'examples[0].input_ref',
  ],
  [
    'ref url too long',
    (f) => {
      delete ex(f).input;
      ex(f).input_ref = { url: `https://docs.example.org/${longString(2100)}`, sha256: sha };
    },
    'example_ref_invalid',
    'error',
    'examples[0].input_ref',
    'the file reference needs a url of at most 2048 characters',
  ],
  [
    'ref sha256 invalid',
    (f) => {
      delete ex(f).input;
      ex(f).input_ref = { url: 'https://docs.example.org/a.json', sha256: 'ABC' };
    },
    'example_ref_sha256_invalid',
    'error',
    'examples[0].input_ref',
    'sha256 must be 64 lowercase hexadecimal characters',
  ],
  [
    'ref media type invalid',
    (f) => {
      delete ex(f).input;
      ex(f).input_ref = { url: 'https://docs.example.org/a.json', sha256: sha, media_type: 'pdf' };
    },
    'example_ref_media_type_invalid',
    'error',
    'examples[0].input_ref',
    'media_type "pdf" must look like type/subtype',
  ],
  [
    'ref unpinned',
    (f) => {
      delete ex(f).input;
      ex(f).input_ref = { url: 'https://docs.example.org/a.json' };
    },
    'example_ref_unpinned',
    'warning',
    'examples[0].input_ref',
    'this reference is not pinned. If the file at that address changes, your scores change with it. Add sha256 to freeze it.',
  ],
  [
    'ref signed url',
    (f) => {
      delete ex(f).input;
      ex(f).input_ref = {
        url: 'https://docs.example.org/a.json?X-Amz-Signature=abc',
        sha256: sha,
      };
    },
    'example_ref_signed_url',
    'warning',
    'examples[0].input_ref',
    'this address looks like a signed link. Anyone who can read the flow can use it until it expires, and it will stop working. Prefer a stable public address.',
  ],
  [
    'expected missing',
    (f) => {
      delete ex(f).expected;
    },
    'example_expected_missing',
    'error',
    'examples[0].expected',
    'example "standard_eur_invoice" does not say what a good result is: add a rubric, fields, exact or reference',
  ],
  [
    'expected empty',
    (f) => {
      ex(f).expected = {};
    },
    'example_expected_empty',
    'error',
    'examples[0].expected',
    'this expectation checks nothing; add a rubric, fields, exact, reference, must_not or must_not_contain',
  ],
  [
    'status completed alone is empty',
    (f) => {
      ex(f).expected = { status: 'completed' };
    },
    'example_expected_empty',
    'error',
    'examples[0].expected',
  ],
  [
    'fields and exact',
    (f) => {
      ex(f).expected.exact = { vendor: 'x' };
    },
    'example_expected_conflict',
    'error',
    'examples[0].expected',
    'use fields (some fields) or exact (the whole result), not both',
  ],
  [
    'fields with failed status',
    (f) => {
      ex(f).expected.status = 'failed';
    },
    'example_expected_conflict',
    'error',
    'examples[0].expected',
    'a case that ends in failed has no output to match; remove fields and exact, or expect status completed',
  ],
  [
    'field unknown',
    (f) => {
      ex(f).expected.fields = { totl: { equals: 1 } };
    },
    'example_expected_field_unknown',
    'error',
    'examples[0].expected.fields.totl',
    '"totl" is not an output of this flow (outputs: vendor, total, currency)',
  ],
  [
    'exact key unknown',
    (f) => {
      delete ex(f).expected.fields;
      ex(f).expected.exact = { totl: 1 };
    },
    'example_expected_field_unknown',
    'error',
    'examples[0].expected.exact.totl',
  ],
  [
    'field unchecked',
    (f) => {
      delete f.output;
    },
    'example_expected_field_unchecked',
    'warning',
    'examples[0].expected.fields.currency',
    'this flow declares no output list, so "currency" cannot be checked against it',
  ],
  [
    'matcher none',
    (f) => {
      ex(f).expected.fields = { total: {} };
    },
    'example_field_matcher_invalid',
    'error',
    'examples[0].expected.fields.total',
    'write exactly one of equals, contains, not_contains, matches, one_of, approx, present',
  ],
  [
    'matcher two',
    (f) => {
      ex(f).expected.fields = { total: { equals: 1, contains: 'x' } };
    },
    'example_field_matcher_invalid',
    'error',
    'examples[0].expected.fields.total',
  ],
  [
    'matcher pattern too long',
    (f) => {
      ex(f).expected.fields = {
        total: { matches: longString(EXAMPLES.limits.maxPatternLength + 1) },
      };
    },
    'example_field_matcher_invalid',
    'error',
    'examples[0].expected.fields.total',
    'the pattern in matches must be a valid regular expression of at most 512 characters',
  ],
  [
    'matcher approx without tolerance',
    (f) => {
      ex(f).expected.fields = { total: { approx: 1 } };
    },
    'example_field_matcher_invalid',
    'error',
    'examples[0].expected.fields.total',
    'approx needs a tolerance (a number, zero or more) beside it, and tolerance is only for approx',
  ],
  [
    'matcher negative tolerance',
    (f) => {
      ex(f).expected.fields = { total: { approx: 1, tolerance: -1 } };
    },
    'example_field_matcher_invalid',
    'error',
    'examples[0].expected.fields.total',
  ],
  [
    'rubric blank',
    (f) => {
      ex(f).expected.rubric = '   ';
    },
    'example_rubric_empty',
    'error',
    'examples[0].expected.rubric',
    'the rubric is empty; write what a good result looks like, or remove it',
  ],
  [
    'rubric too long',
    (f) => {
      ex(f).expected.rubric = longString(4001);
    },
    'example_rubric_too_long',
    'error',
    'examples[0].expected.rubric',
    'the rubric is 4001 characters; the limit is 4000',
  ],
  [
    'reference both',
    (f) => {
      ex(f).expected.reference = { text: 'a', ref: { url: 'https://docs.example.org/a.md' } };
    },
    'example_reference_invalid',
    'error',
    'examples[0].expected.reference',
    'a reference needs exactly one of text or ref',
  ],
  [
    'reference neither',
    (f) => {
      ex(f).expected.reference = {};
    },
    'example_reference_invalid',
    'error',
    'examples[0].expected.reference',
  ],
  [
    'reference binary',
    (f) => {
      ex(f).expected.reference = {
        ref: { url: 'https://docs.example.org/a.pdf', sha256: sha, media_type: 'application/pdf' },
      };
    },
    'example_reference_binary',
    'warning',
    'examples[0].expected.reference',
    'this reference is not text, so it cannot be compared in this version; the example will be skipped, not failed.',
  ],
  [
    'must_not blank',
    (f) => {
      ex(f).expected.must_not = [' '];
    },
    'example_must_not_invalid',
    'error',
    'examples[0].expected.must_not[0]',
  ],
  [
    'must_not_contain empty',
    (f) => {
      ex(f).expected.must_not_contain = [''];
    },
    'example_must_not_contain_invalid',
    'error',
    'examples[0].expected.must_not_contain[0]',
  ],
  [
    'contradiction',
    (f) => {
      ex(f).expected.must_not_contain = ['eur'];
    },
    'example_expectation_contradiction',
    'warning',
    'examples[0].expected.fields.currency',
    '"eur" is required by "currency" and forbidden by must_not_contain',
  ],
  [
    'status invalid',
    (f) => {
      ex(f).expected.status = 'done';
    },
    'example_status_invalid',
    'error',
    'examples[0].expected.status',
    'status must be completed, failed or paused_for_human',
  ],
  [
    'min_score high',
    (f) => {
      ex(f).min_score = 1.2;
    },
    'example_min_score_range',
    'error',
    'examples[0].min_score',
    'example "standard_eur_invoice" has min_score 1.2; use a number from 0 to 1 (0.7 is 7.3 out of 10)',
  ],
  [
    'expectation min_score range',
    (f) => {
      ex(f).expected.min_score = -0.1;
    },
    'example_min_score_range',
    'error',
    'examples[0].expected.min_score',
    'min_score -0.1 is out of range; use a number from 0 to 1',
  ],
  [
    'side_effects invalid',
    (f) => {
      ex(f).side_effects = 'maybe';
    },
    'example_side_effects_invalid',
    'error',
    'examples[0].side_effects',
    'example "standard_eur_invoice" has side_effects "maybe"; use refuse or allow',
  ],
  [
    'checkpoint unknown step',
    (f) => {
      ex(f).checkpoints = { classify: { rubric: 'r' } };
    },
    'example_checkpoint_step_unknown',
    'error',
    'examples[0].checkpoints.classify',
    'example "standard_eur_invoice": checkpoint "classify" is not a step of this flow (steps: extract, finish)',
  ],
  [
    'checkpoint on a for_each step',
    (f) => {
      f.steps.finish.for_each = { items: '{{ .data.vendor }}' };
      ex(f).checkpoints = { finish: { rubric: 'r' } };
    },
    'example_checkpoint_step_composite',
    'error',
    'examples[0].checkpoints.finish',
    'example "standard_eur_invoice": step "finish" repeats or branches, so there is no single result to check; put the checkpoint on a plain step or check the final output',
  ],
  [
    'checkpoint on a parallel step',
    (f) => {
      f.steps.finish.next = { parallel: { steps: ['extract'] } };
      ex(f).checkpoints = { finish: { rubric: 'r' } };
    },
    'example_checkpoint_step_composite',
    'error',
    'examples[0].checkpoints.finish',
  ],
  [
    'checkpoint status',
    (f) => {
      ex(f).checkpoints = { extract: { rubric: 'r', status: 'failed' } };
    },
    'example_checkpoint_status',
    'error',
    'examples[0].checkpoints.extract.status',
    'example "standard_eur_invoice": a checkpoint cannot set status; status describes how the whole run ends',
  ],
  [
    'checkpoint field unchecked',
    (f) => {
      ex(f).checkpoints = { extract: { fields: { x: { equals: 1 } } } };
    },
    'example_expected_field_unchecked',
    'warning',
    'examples[0].checkpoints.extract.fields.x',
    'this step declares no output_schema, so "x" cannot be checked against it',
  ],
  [
    'checkpoint field unknown',
    (f) => {
      f.steps.extract.output_schema = { version: 1, fields: [{ name: 'vendor', type: 'string' }] };
      ex(f).checkpoints = { extract: { fields: { x: { equals: 1 } } } };
    },
    'example_expected_field_unknown',
    'error',
    'examples[0].checkpoints.extract.fields.x',
    '"x" is not a field this step declares in its output_schema (declared: vendor)',
  ],
  [
    'too many variants',
    (f) => {
      ex(f).variants = Array.from({ length: 11 }, (_, i) => ({
        id: `v_${String.fromCharCode(97 + i)}x`,
        origin: 'author',
        expected: { rubric: 'r' },
      }));
    },
    'example_variants_too_many',
    'error',
    'examples[0].variants',
    'example "standard_eur_invoice" has 11 variants; the limit is 10',
  ],
  [
    'variant id invalid',
    (f) => {
      ex(f).variants = [{ id: 'X', origin: 'author', expected: { rubric: 'r' } }];
    },
    'example_variant_id_invalid',
    'error',
    'examples[0].variants[0].id',
  ],
  [
    'variant id duplicate',
    (f) => {
      const v = { id: 'same', origin: 'author', expected: { rubric: 'r' } };
      ex(f).variants = [v, { ...v }];
    },
    'example_variant_id_duplicate',
    'error',
    'examples[0].variants[1].id',
    'variant id "same" is used twice in example "standard_eur_invoice"',
  ],
  [
    'variant origin missing',
    (f) => {
      ex(f).variants = [{ id: 'smudged', expected: { rubric: 'r' } }];
    },
    'example_variant_origin_invalid',
    'error',
    'examples[0].variants[0].origin',
    'variant "smudged" of example "standard_eur_invoice" has origin ""; use author (a person wrote or approved it) or synthetic (generated)',
  ],
  [
    'variant origin outside the vocabulary',
    (f) => {
      ex(f).variants = [{ id: 'smudged', origin: 'human', expected: { rubric: 'r' } }];
    },
    'example_variant_origin_invalid',
    'error',
    'examples[0].variants[0].origin',
    'variant "smudged" of example "standard_eur_invoice" has origin "human"; use author (a person wrote or approved it) or synthetic (generated)',
  ],
  [
    'variant empty',
    (f) => {
      ex(f).variants = [{ id: 'nothing', origin: 'author', guidance: 'g' }];
    },
    'example_variant_empty',
    'error',
    'examples[0].variants[0]',
    'variant "nothing" of example "standard_eur_invoice" changes neither the input nor the expectation',
  ],
  [
    'variant patch and ref',
    (f) => {
      ex(f).variants = [
        {
          id: 'both',
          origin: 'author',
          input_patch: { invoice_text: 'y' },
          input_ref: { url: 'https://docs.example.org/a.json', sha256: sha },
        },
      ];
    },
    'example_variant_input_conflict',
    'error',
    'examples[0].variants[0]',
  ],
  [
    'variant patched input invalid',
    (f) => {
      ex(f).variants = [{ id: 'bad', origin: 'author', input_patch: { currency_hint: 'GBP' } }];
    },
    'example_variant_input_invalid',
    'error',
    'examples[0].variants[0].input_patch.currency_hint',
    'example "standard_eur_invoice/bad": input field "currency_hint" value "GBP" is not one of [EUR,USD,CHF]',
  ],
  [
    'variant patch secret',
    (f) => {
      ex(f).variants = [{ id: 'tok', origin: 'author', input_patch: { crm_token: 'plain' } }];
    },
    'example_secret_value',
    'error',
    'examples[0].variants[0].input_patch.crm_token',
  ],
  [
    'variant unchecked on input_ref parent',
    (f) => {
      delete ex(f).input;
      ex(f).input_ref = { url: 'https://docs.example.org/a.json', sha256: sha };
      ex(f).variants = [{ id: 'p', origin: 'author', input_patch: { a: 1 } }];
    },
    'example_variant_unchecked',
    'warning',
    'examples[0].variants[0].input_patch',
  ],
  [
    'all held out',
    (f) => {
      ex(f).hold_out = true;
    },
    'examples_all_held_out',
    'warning',
    'examples',
    'every example is held out, so nothing is left to tune on',
  ],
  [
    'public flow warning',
    (f) => {
      f.visibility = 'public';
    },
    'examples_published_with_public_flow',
    'warning',
    'examples',
    'this flow is public, so everyone who can see it can read its examples, including their expected results. Only publish examples you are happy to show.',
  ],
  [
    'unreadable by judge',
    (f) => {
      ex(f).expected = {
        reference: {
          ref: {
            url: 'https://docs.example.org/a.pdf',
            sha256: sha,
            media_type: 'application/pdf',
          },
        },
      };
    },
    'examples_unreadable_by_judge',
    'warning',
    'examples[0].expected',
    'this example can be run but not scored',
  ],
];

// The reference raises this one from the save door, beside its SSRF guard.
const NOT_PORTED = new Set(['example_ref_blocked_host']);

describe('examples: one fixture per code', () => {
  it('the clean fixture raises no example finding of any kind', () => {
    const issues = exampleIssues(base());
    expect(issues).toEqual([]);
    const r = validateFlow(BASE_YAML);
    expect(r.valid).toBe(true);
    expect(r.warnings.filter((w) => /^examples?_/.test(w.code))).toEqual([]);
  });

  for (const [name, mutate, code, severity, field, message] of ROWS) {
    it(`${name} -> ${code}`, () => {
      const flow = base();
      mutate(flow);
      const found = exampleIssues(flow).find((i) => i.code === code);
      expect(found, `expected a ${code} finding`).toBeDefined();
      expect(found?.severity).toBe(severity);
      expect(found?.field).toBe(field);
      if (message !== undefined) expect(found?.message).toBe(message);
      // The spec states each code's severity once; the walker must agree.
      expect(EXAMPLES.codes[code]).toBe(severity);
    });
  }

  it('every code in the spec has a fixture here (bar the one not ported)', () => {
    const covered = new Set(ROWS.map((r) => r[2]));
    for (const code of Object.keys(EXAMPLES.codes)) {
      if (NOT_PORTED.has(code)) continue;
      expect(covered, `no fixture for ${code}`).toContain(code);
    }
  });

  it('an error blocks the verdict and a warning never does', () => {
    const bad = base();
    ex(bad).title = '';
    expect(validateFlowObject(bad).valid).toBe(false);
    const warned = base();
    delete ex(warned).guidance;
    expect(validateFlowObject(warned).valid).toBe(true);
  });
});

describe('examples: false positives', () => {
  it('ordinary slugs and prose do not read as credentials', () => {
    for (const text of [
      'risk-assessment-for-the-quarterly-report-2025',
      'desk-reservation-system-for-all-floors-of-the-office',
      'The task-force-meeting-notes-are-attached-below-in-full',
      'bearer of bad news',
      'crn_short',
      'api_key: "aivk_placeholder"',
      'aivk_placeholder',
    ]) {
      const f = base();
      ex(f).guidance = text;
      expect(exampleIssues(f), text).toEqual([]);
    }
  });

  it('each credential shape is caught, built at run time', () => {
    const shapes: Record<string, string> = {
      'an API key': `sk-${'a'.repeat(24)}`,
      'a platform API key': `crn_${'a'.repeat(20)}`,
      'an AWS access key': `AKIA${'A'.repeat(16)}`,
      'a private key': `-----BEGIN ${'RSA PRIVATE KEY'}-----`,
      'a bearer token': `Bearer ${'a'.repeat(24)}`,
      'a Slack token': `xoxb-${'1'.repeat(12)}`,
      'a GitHub token': `ghp_${'a'.repeat(34)}`,
      'a retired registry key': `aivk_${'a'.repeat(24)}`,
    };
    expect(Object.keys(shapes)).toHaveLength(EXAMPLES.secretPatterns.length);
    for (const [name, value] of Object.entries(shapes)) {
      const f = base();
      ex(f).guidance = `prefix ${value} suffix`;
      const hit = exampleIssues(f).find((i) => i.code === 'example_secret_like_value');
      expect(hit?.message, name).toContain(`(${name})`);
    }
  });

  it('a credential shape is found at every depth the reference scans', () => {
    const secret = `sk-${'a'.repeat(24)}`;
    const places: Array<[string, (f: Doc) => void, string]> = [
      ['title', (f) => (ex(f).title = secret), 'examples[0].title'],
      ['notes', (f) => (ex(f).notes = secret), 'examples[0].notes'],
      [
        'input leaf',
        (f) => (ex(f).input = { invoice_text: secret }),
        'examples[0].input.invoice_text',
      ],
      ['rubric', (f) => (ex(f).expected.rubric = secret), 'examples[0].expected.rubric'],
      [
        'equals leaf',
        (f) => (ex(f).expected.fields.currency.equals = secret),
        'examples[0].expected.fields.currency.equals',
      ],
      [
        'one_of leaf',
        (f) => (ex(f).expected.fields = { currency: { one_of: ['EUR', secret] } }),
        'examples[0].expected.fields.currency.one_of[1]',
      ],
      [
        'variant patch',
        (f) =>
          (ex(f).variants = [
            { id: 'v_one', origin: 'author', input_patch: { invoice_text: secret } },
          ]),
        'examples[0].variants[0].input_patch.invoice_text',
      ],
      [
        'checkpoint rubric',
        (f) => (ex(f).checkpoints = { extract: { rubric: secret } }),
        'examples[0].checkpoints.extract.rubric',
      ],
    ];
    for (const [name, mutate, field] of places) {
      const f = base();
      mutate(f);
      const fields = exampleIssues(f)
        .filter((i) => i.code === 'example_secret_like_value')
        .map((i) => i.field);
      expect(fields, name).toContain(field);
    }
  });

  it('a variant deleting a secret with null is fine', () => {
    const f = base();
    ex(f).variants = [
      { id: 'no_token', origin: 'author', input_patch: { crm_token: null, invoice_text: 'y' } },
    ];
    expect(exampleIssues(f)).toEqual([]);
  });

  it('input: {} is fine for a flow with no input', () => {
    const f = base();
    delete f.input_schema;
    f.query = { topic: { type: 'string' } };
    ex(f).input = {};
    expect(exampleIssues(f)).toEqual([]);
    const g = base();
    g.input_schema = { version: 1, fields: [] };
    ex(g).input = {};
    expect(exampleIssues(g)).toEqual([]);
  });

  it('public hosts and an https reference with a pinned digest are clean', () => {
    for (const url of [
      'https://docs.example.org/a.json',
      'https://93.184.216.34/invoices/a.json',
      'https://internal.example.org/a.json',
      'https://localhost.example.org/a.json',
      'https://[2606:4700:4700::1111]/a.json',
      'https://docs.example.org:8443/a.json?page=2&format=json',
      'HTTPS://docs.example.org/a.json',
    ]) {
      const f = base();
      delete ex(f).input;
      ex(f).input_ref = { url, sha256: sha };
      expect(exampleIssues(f), url).toEqual([]);
    }
  });

  it('a query key that merely contains a signing word is not a signed link', () => {
    const f = base();
    delete ex(f).input;
    ex(f).input_ref = {
      url: 'https://docs.example.org/a.json?signature_type=pdf&tokens=1',
      sha256: sha,
    };
    expect(exampleIssues(f)).toEqual([]);
  });

  it('a regular expression the reference engine accepts is not refused for how it spells a group', () => {
    const f = base();
    ex(f).expected.fields = { total: { matches: '(?P<n>[0-9]+)' } };
    expect(exampleIssues(f)).toEqual([]);
  });

  it('a zero or false value reads as present', () => {
    const f = base();
    ex(f).expected = { exact: { vendor: 0 } };
    expect(exampleIssues(f)).toEqual([]);
    const g = base();
    ex(g).expected = { fields: { total: { equals: false } } };
    expect(exampleIssues(g)).toEqual([]);
    const h = base();
    ex(h).expected = { fields: { total: { present: false } } };
    expect(exampleIssues(h)).toEqual([]);
    const i = base();
    ex(i).min_score = 0;
    expect(exampleIssues(i)).toEqual([]);
  });

  it('a flow with no examples is unchanged', () => {
    const f = base();
    delete f.examples;
    expect(exampleIssues(f)).toEqual([]);
    f.examples = [];
    expect(exampleIssues(f)).toEqual([]);
  });
});

describe('examples: the narrowed input check', () => {
  const schema = (fields: Doc[]): Doc => ({ version: 1, fields });
  const judge = (fields: Doc[], input: Doc): ValidationIssue[] => {
    const f = base();
    f.input_schema = schema(fields);
    ex(f).input = input;
    return exampleIssues(f).filter((i) => i.code === 'example_input_invalid');
  };

  it('judges the kind of every field type', () => {
    const kinds: Array<[string, Doc, Doc]> = [
      ['string', 'a', 1],
      ['multiline', 'a', true],
      ['number', 1.5, '1.5'],
      ['bool', true, 'true'],
      ['array_of_strings', ['a', 'b'], 'a'],
      ['date', '2026-01-01', 20260101],
    ];
    for (const [type, good, bad] of kinds) {
      const fields = [{ name: 'v', type, label: 'v' }];
      expect(judge(fields, { v: good }), `${type} accepts its kind`).toEqual([]);
      expect(
        judge(fields, { v: bad }).map((i) => i.field),
        `${type} refuses another`,
      ).toEqual(['examples[0].input.v']);
    }
    const arr = [{ name: 'v', type: 'array_of_strings', label: 'v' }];
    expect(judge(arr, { v: ['a', 2] })[0]?.message).toBe(
      'example "standard_eur_invoice": input field "v" index 1 is not a string',
    );
  });

  it('accepts a number the reference accepts, NaN and infinity included', () => {
    const fields = [{ name: 'v', type: 'number', label: 'v' }];
    expect(judge(fields, { v: Number.NaN })).toEqual([]);
    expect(judge(fields, { v: Number.POSITIVE_INFINITY })).toEqual([]);
  });

  it('does not judge length, range, pattern or date shape (a documented narrowing)', () => {
    const fields = [
      { name: 's', type: 'string', label: 's', max_length: 2, pattern: '^[0-9]+$' },
      { name: 'n', type: 'number', label: 'n', min: 10, max: 20 },
      { name: 'd', type: 'date', label: 'd' },
      { name: 'a', type: 'array_of_strings', label: 'a', max_items: 1 },
    ];
    expect(judge(fields, { s: 'abcdef', n: 5000, d: 'not a date', a: ['x', 'y', 'z'] })).toEqual(
      [],
    );
  });

  it('honours visible_when, and skips a required secret', () => {
    const fields = [
      { name: 'kind', type: 'enum', label: 'k', enum: ['a', 'b'] },
      {
        name: 'extra',
        type: 'string',
        label: 'e',
        required: true,
        visible_when: { field: 'kind', equals: 'b' },
      },
      { name: 'token', type: 'secret', label: 't', required: true },
    ];
    expect(judge(fields, { kind: 'a' })).toEqual([]);
    expect(judge(fields, { kind: 'b' }).map((i) => i.field)).toEqual(['examples[0].input.extra']);
    // a visibility predicate never matches across kinds: true is not "true"
    const cross = [
      { name: 'flag', type: 'bool', label: 'f' },
      {
        name: 'why',
        type: 'string',
        label: 'w',
        required: true,
        visible_when: { field: 'flag', equals: true },
      },
    ];
    expect(judge(cross, { flag: true }).map((i) => i.field)).toEqual(['examples[0].input.why']);
    // only the kind error on `flag` itself: `why` stays hidden, so it is not required
    expect(judge(cross, { flag: 'true' }).map((i) => i.field)).toEqual(['examples[0].input.flag']);
    const inList = [
      { name: 'k', type: 'string', label: 'k' },
      {
        name: 'w',
        type: 'string',
        label: 'w',
        required: true,
        visible_when: { field: 'k', in: ['x', 'y'] },
      },
    ];
    expect(judge(inList, { k: 'y' }).map((i) => i.field)).toEqual(['examples[0].input.w']);
    expect(judge(inList, { k: 'z' })).toEqual([]);
  });

  it('judges a file value as a reference mapping, and flags a mapping with other keys', () => {
    const fields = [{ name: 'scan', type: 'file', label: 's' }];
    const run = (value: Doc): string[] => {
      const f = base();
      f.input_schema = schema(fields);
      ex(f).input = { scan: value };
      return exampleIssues(f).map((i) => i.code);
    };
    expect(run({ url: 'https://docs.example.org/a.pdf', sha256: sha })).toEqual([]);
    expect(run({ url: 'https://docs.example.org/a.pdf', extra: 1 })).toContain(
      'example_file_input_needs_ref',
    );
    expect(run('slot_1')).toContain('example_file_input_needs_ref');
    expect(run({ note: 'no url' })).toContain('example_ref_invalid');
  });

  it('reads an enum list written with numbers as text, like the reference', () => {
    const fields = [{ name: 'v', type: 'enum', label: 'v', enum: ['1', '2'] }];
    expect(judge(fields, { v: '1' })).toEqual([]);
    expect(judge(fields, { v: 1 })).toHaveLength(1);
  });

  it('a date object from another loader is a date string, not a kind error', () => {
    const fields = [{ name: 'd', type: 'date', label: 'd' }];
    expect(judge(fields, { d: new Date('2026-01-01T00:00:00Z') })).toEqual([]);
  });

  it('a key named like an object prototype member is an ordinary key', () => {
    const f = base();
    ex(f).input = JSON.parse('{"invoice_text":"x","__proto__":{"polluted":1}}');
    const found = exampleIssues(f).filter((i) => i.code === 'example_input_invalid');
    expect(found.map((i) => i.field)).toEqual(['examples[0].input.__proto__']);
    expect(({} as Doc).polluted).toBeUndefined();
  });
});

describe('examples: the merge patch', () => {
  it('merges, deletes with null, replaces anything else, and mutates nothing', () => {
    const baseInput = { a: 1, b: { c: 2, d: 3 }, e: 'x' };
    const got = applyExamplePatch(baseInput, { b: { c: null, f: 4 }, e: null, g: [1] }) as Doc;
    expect(got.b).toEqual({ d: 3, f: 4 });
    expect('e' in got).toBe(false);
    expect(got.a).toBe(1);
    expect(got.g).toEqual([1]);
    expect(baseInput).toEqual({ a: 1, b: { c: 2, d: 3 }, e: 'x' });
    got.b.d = 99;
    expect(baseInput.b.d).toBe(3);
  });

  it('a patch with an object where the base has a scalar replaces it by a merged object', () => {
    expect(applyExamplePatch({ a: 1 }, { a: { b: null, c: 2 } })).toEqual({ a: { c: 2 } });
  });
});

describe('examples: unknown keys at every depth', () => {
  const typos: Array<[string, string, string]> = [
    ['example level', '    guidance:', '    guidence:'],
    ['expected level', '      rubric:', '      rubrik:'],
    ['matcher level', 'tolerance: 0.005', 'tolerence: 0.005'],
    ['flow level', '\nexamples:', '\nexample:'],
  ];
  for (const [name, from, to] of typos) {
    it(`${name}: a typo is reported`, () => {
      const r = validateFlow(BASE_YAML.replace(from, to));
      expect(r.valid).toBe(false);
      expect(r.errors.map((e) => e.code)).toContain('unknown_yaml_key');
    });
  }

  it('variant level: a key a variant cannot set is reported', () => {
    const yaml = BASE_YAML.replace(
      '    expected:\n',
      '    variants:\n      - { id: v_one, origin: author, hold_out: true, input_patch: { invoice_text: z } }\n    expected:\n',
    );
    const r = validateFlow(yaml);
    const hit = r.errors.find((e) => e.code === 'unknown_yaml_key');
    expect(hit?.field).toBe('examples[0].variants[0].hold_out');
  });

  it('checkpoint level: an expectation key and the optional flag are known, a typo is not', () => {
    const ok = BASE_YAML.replace(
      '    expected:\n',
      '    checkpoints:\n      extract: { rubric: r, optional: true }\n    expected:\n',
    );
    expect(validateFlow(ok).errors.filter((e) => e.code === 'unknown_yaml_key')).toEqual([]);
    const typo = ok.replace('optional: true', 'optionel: true');
    expect(validateFlow(typo).errors.map((e) => e.field)).toContain(
      'examples[0].checkpoints.extract.optionel',
    );
  });

  it('reference and file-reference levels', () => {
    const yaml = BASE_YAML.replace(
      '      rubric: "The vendor is spelled as printed."\n',
      '      rubric: "r"\n      reference: { ref: { url: "https://docs.example.org/a.md", sha265: "x" } }\n',
    );
    const r = validateFlow(yaml);
    expect(r.errors.map((e) => e.field)).toContain('examples[0].expected.reference.ref.sha265');
  });
});

describe('examples: scalar spellings', () => {
  it('an id written as a number is read by its text', () => {
    const r = validateFlow(BASE_YAML.replace('id: standard_eur_invoice', 'id: 12'));
    expect(r.errors.find((e) => e.code === 'example_id_invalid')?.message).toContain('"12"');
  });

  it('a sha256 that YAML would read as a number is read by its source text', () => {
    // 64 digits with no letter: a YAML float. The reference stores it as text.
    const digits = '1'.repeat(64);
    const yaml = BASE_YAML.replace(
      '    input:\n      invoice_text: "Mueller GmbH Gesamtbetrag 1.190,00 EUR"\n      currency_hint: EUR\n',
      `    input_ref: { url: "https://docs.example.org/a.json", sha256: ${digits} }\n`,
    );
    const r = validateFlow(yaml);
    expect(r.errors.filter((e) => /^examples?_/.test(e.code))).toEqual([]);
    expect(r.warnings.filter((w) => w.code === 'example_ref_unpinned')).toEqual([]);
  });
});
