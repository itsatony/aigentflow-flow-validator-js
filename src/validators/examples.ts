// The `examples:` block: concrete cases (an input, what a good result looks
// like, why the case matters) recorded inside the flow document.
//
// Port of the reference's single examples walker. The engine never reads this
// block; the validator is its only reader here, so every rule is a save-time
// judgement of the DOCUMENT. The walker is PURE and OFFLINE: it never fetches a
// reference and never resolves a host.
//
// Findings carry their own severity (the spec's `examples.codes` states it once
// per code and a test holds the two together). Messages are the reference's own
// wording, with the path carried in `field`.
//
// What differs from the reference is listed in PARITY.md ("The examples block"):
// the inline `input` is judged by a NARROWED check (unknown field, required,
// value kind, enum membership — no length/min/max/pattern/date-format), a
// `matches` pattern is judged by length only (RE2 and JS RegExp disagree about
// what compiles), and `example_ref_blocked_host` is not ported.

import type { Flow } from '../types.js';
import { EXAMPLES } from '../spec/index.js';
import { goParseURLParts, goQueryKeys, goToLower, goTrimSpace } from './goUrl.js';
import { Issues, isRecord } from './util.js';

type Rec = Record<string, unknown>;
type Severity = 'error' | 'warning';

interface Finding {
  code: string;
  severity: Severity;
  field: string;
  message: string;
  suggestion?: string;
}

// ---------------------------------------------------------------------------
// Vocabulary the spec does not carry as a list of its own.
// ---------------------------------------------------------------------------

const KEY_EXAMPLES = 'examples';
const VISIBILITY_PUBLIC = 'public';
const STATUS_COMPLETED = 'completed';
const STATUS_FAILED = 'failed';
const STATUS_PAUSED_FOR_HUMAN = 'paused_for_human';
const ORIGIN_NONE = '';
const SIDE_EFFECTS_NONE = '';
const SCHEME_HTTPS = 'https';
const FILE_REF_KEYS: ReadonlySet<string> = new Set(['url', 'sha256', 'media_type', 'note']);
const FILE_REF_KEY = 'ref';
const TYPE_SECRET = 'secret';
const TYPE_FILE = 'file';
const TYPE_STRING = 'string';
const TYPE_MULTILINE = 'multiline';
const TYPE_NUMBER = 'number';
const TYPE_BOOL = 'bool';
const TYPE_ENUM = 'enum';
const TYPE_ARRAY_OF_STRINGS = 'array_of_strings';
const TYPE_DATE = 'date';
/** How deep a value is followed (the reference's own bound on a self-referential alias). */
const MAX_RECURSION_DEPTH = 32;
/** The one status a checkpoint may not name and an expectation may omit. */
const TEXTUAL_MEDIA_BASES: ReadonlySet<string> = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/markdown',
]);

const SUGGESTION_ID =
  'Pick a short stable name such as standard_invoice; it is the key results are filed under, so it never changes once saved';
const SUGGESTION_CHECKPOINT = 'Did you rename the step? Update the checkpoint to the new name';
const SUGGESTION_SECRET_VALUE = 'Remove the value; you are asked for it when you run the check';
const SUGGESTION_EXPECTED =
  'Add at least a rubric: one or two sentences on what a good result looks like';

// ---------------------------------------------------------------------------
// Go formatting helpers (the reference's messages are Go `Sprintf` output).
// ---------------------------------------------------------------------------

const utf8Encoder = new TextEncoder();

function byteLen(s: string): number {
  return utf8Encoder.encode(s).length;
}

/** Go's `utf8.RuneCountInString`. */
function runeCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Go's `%q` for a string. */
function q(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (c === 0x07) out += '\\a';
    else if (c === 0x08) out += '\\b';
    else if (c === 0x0c) out += '\\f';
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x0d) out += '\\r';
    else if (c === 0x09) out += '\\t';
    else if (c === 0x0b) out += '\\v';
    else if (c < 0x20 || c === 0x7f) out += `\\x${c.toString(16).padStart(2, '0')}`;
    else if (c >= 0x80 && /[\p{C}\p{Z}]/u.test(ch)) {
      out +=
        c > 0xffff
          ? `\\U${c.toString(16).padStart(8, '0')}`
          : `\\u${c.toString(16).padStart(4, '0')}`;
    } else out += ch;
  }
  return `${out}"`;
}

/** Go `%v` for a float64: the shortest representation, in exponent form below 1e-4 and from 1e6 up. */
function num(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return '+Inf';
  if (n === -Infinity) return '-Inf';
  if (n === 0) return Object.is(n, -0) ? '-0' : '0';
  const [mantissa = '', exponent = '0'] = n.toExponential().split('e');
  const exp = Number(exponent);
  if (exp < -4 || exp >= 6) {
    const sign = exp < 0 ? '-' : '+';
    return `${mantissa}e${sign}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return String(n);
}

function has(o: Rec, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key) && o[key] !== null && o[key] !== undefined;
}

function own(o: Rec, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
}

function setOwn(o: Rec, key: string, value: unknown): void {
  Object.defineProperty(o, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function sortedKeys(o: Rec): string[] {
  return Object.keys(o).sort();
}

/** A Go `*float64` read: a YAML number, or absent. */
function numberOf(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

// ---------------------------------------------------------------------------
// Values: normalisation and the RFC 7386 merge patch.
// ---------------------------------------------------------------------------

/**
 * Turn what a loader may hand over into something a live run would receive: a
 * date object (a loader that resolves timestamps) becomes the string a JSON
 * body carries, and depth is bounded so a self-referential alias terminates.
 * The `yaml` package this validator parses with leaves a date a string, so for
 * parsed text this is the identity.
 */
function normalize(v: unknown, depth: number): unknown {
  if (depth > MAX_RECURSION_DEPTH) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const iso = v.toISOString();
    if (/T00:00:00\.000Z$/.test(iso)) return iso.slice(0, 10);
    return iso.replace(/\.000Z$/, 'Z');
  }
  if (Array.isArray(v)) return v.map((x) => normalize(x, depth + 1));
  if (isRecord(v)) {
    const out: Rec = {};
    for (const k of Object.keys(v)) setOwn(out, k, normalize(v[k], depth + 1));
    return out;
  }
  return v;
}

function deepCopy(v: unknown, depth: number): unknown {
  if (depth > MAX_RECURSION_DEPTH) return v;
  if (Array.isArray(v)) return v.map((x) => deepCopy(x, depth + 1));
  if (isRecord(v)) {
    const out: Rec = {};
    for (const k of Object.keys(v)) setOwn(out, k, deepCopy(v[k], depth + 1));
    return out;
  }
  return v;
}

function mergePatch(target: Rec, patch: Rec, depth: number): void {
  if (depth > MAX_RECURSION_DEPTH) return;
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    if (pv === null || pv === undefined) {
      delete target[k];
      continue;
    }
    if (isRecord(pv)) {
      const current = own(target, k);
      const existing: Rec = isRecord(current) ? (deepCopy(current, 0) as Rec) : {};
      mergePatch(existing, pv, depth + 1);
      setOwn(target, k, existing);
      continue;
    }
    setOwn(target, k, deepCopy(pv, 0));
  }
}

/**
 * RFC 7386 JSON Merge Patch: a mapping merges recursively, null deletes the
 * key, anything else replaces. The base is never mutated and the result shares
 * no object with either argument.
 */
export function applyExamplePatch(base: Rec, patch: Rec): Rec {
  const out = deepCopy(base, 0) as Rec;
  mergePatch(out, patch, 0);
  return out;
}

// ---------------------------------------------------------------------------
// The file reference
// ---------------------------------------------------------------------------

interface FileRef {
  url: string;
  sha256: string;
  mediaType: string;
  note: string;
}

/** The mapping shape a file-typed input takes, or null when it is anything else. */
function asFileRef(v: unknown): FileRef | null {
  if (!isRecord(v)) return null;
  const keys = Object.keys(v);
  if (keys.length === 0) return null;
  for (const k of keys) if (!FILE_REF_KEYS.has(k)) return null;
  const str = (k: string): string => {
    const x = own(v, k);
    return typeof x === 'string' ? x : '';
  };
  return {
    url: str('url'),
    sha256: str('sha256'),
    mediaType: str('media_type'),
    note: str('note'),
  };
}

function isTextualMediaType(mediaType: string): boolean {
  const base = goToLower(goTrimSpace((mediaType.split(';')[0] ?? '').toString()));
  if (base.startsWith('text/')) return true;
  if (base.endsWith('+json') || base.endsWith('+xml')) return true;
  return TEXTUAL_MEDIA_BASES.has(base);
}

// ---------------------------------------------------------------------------
// The walker
// ---------------------------------------------------------------------------

type ExpectKind = 'final' | 'checkpoint';

class Walker {
  findings: Finding[] = [];

  constructor(
    private readonly flow: Flow,
    private readonly issues: Issues,
  ) {}

  // -- emit -------------------------------------------------------------

  private add(
    severity: Severity,
    code: string,
    field: string,
    message: string,
    suggestion?: string,
  ): void {
    this.findings.push({
      code,
      severity,
      field,
      message,
      ...(suggestion !== undefined ? { suggestion } : {}),
    });
  }

  private err(code: string, field: string, message: string, suggestion?: string): void {
    this.add('error', code, field, message, suggestion);
  }

  private warn(code: string, field: string, message: string): void {
    this.add('warning', code, field, message);
  }

  /** A Go `string` field read by its source text; absent is "". */
  private s(o: Rec, key: string, parentPath: string): string {
    return this.issues.stringOf(o, key, parentPath) ?? '';
  }

  // -- the set ----------------------------------------------------------

  run(examples: unknown[]): void {
    this.validateSet(examples);
    const seen = new Map<string, number>();
    examples.forEach((ex, i) => {
      if (isRecord(ex)) this.validateExample(i, ex, seen);
    });
  }

  private validateSet(examples: unknown[]): void {
    const n = examples.length;
    const L = EXAMPLES.limits;
    if (n > L.maxPerFlow) {
      this.err(
        'examples_too_many',
        KEY_EXAMPLES,
        `flow declares ${n} examples; the limit is ${L.maxPerFlow}`,
      );
    }
    const size = blockBytes(examples);
    if (size !== null && size > L.maxBlockBytes) {
      this.err(
        'examples_block_too_large',
        KEY_EXAMPLES,
        `the examples block is ${size} bytes; the limit is ${L.maxBlockBytes}. Move large inputs or target outputs to a file reference (https URL).`,
      );
    }
    const allHeld = examples.every((e) => isRecord(e) && own(e, 'hold_out') === true);
    if (allHeld) {
      this.warn(
        'examples_all_held_out',
        KEY_EXAMPLES,
        'every example is held out, so nothing is left to tune on',
      );
    }
    if (this.isPublic()) {
      this.warn(
        'examples_published_with_public_flow',
        KEY_EXAMPLES,
        'this flow is public, so everyone who can see it can read its examples, including their expected results. Only publish examples you are happy to show.',
      );
    }
  }

  private isPublic(): boolean {
    return this.s(this.flow as Rec, 'visibility', '') === VISIBILITY_PUBLIC;
  }

  // -- one example ------------------------------------------------------

  private validateExample(i: number, ex: Rec, seen: Map<string, number>): void {
    const L = EXAMPLES.limits;
    const path = `examples[${i}]`;
    const id = this.s(ex, 'id', path);
    const label = id === '' ? `#${i + 1}` : id;

    // id
    if (id === '') {
      this.err('example_id_missing', `${path}.id`, `example #${i + 1} has no id`, SUGGESTION_ID);
    } else if (!EXAMPLES.idPattern.test(id)) {
      this.err(
        'example_id_invalid',
        `${path}.id`,
        `example id ${q(id)} is not valid: use lower-case letters, digits and underscores, starting with a letter (2 to 48 characters)`,
        SUGGESTION_ID,
      );
    } else {
      const first = seen.get(id);
      if (first !== undefined) {
        this.err(
          'example_id_duplicate',
          `${path}.id`,
          `example id ${q(id)} is used by examples #${first + 1} and #${i + 1}`,
        );
      } else {
        seen.set(id, i);
      }
    }

    // title
    const title = this.s(ex, 'title', path);
    if (goTrimSpace(title) === '') {
      this.err(
        'example_title_missing',
        `${path}.title`,
        `example ${q(label)} has no title; the title is what a person sees in the list of examples`,
      );
    } else {
      const n = runeCount(title);
      if (n > L.titleMaxRunes) {
        this.err(
          'example_title_too_long',
          `${path}.title`,
          `example ${q(label)} title is ${n} characters; the limit is ${L.titleMaxRunes}`,
        );
      }
    }

    // guidance / notes
    const guidance = this.s(ex, 'guidance', path);
    if (goTrimSpace(guidance) === '') {
      this.warn(
        'example_guidance_missing',
        `${path}.guidance`,
        `example ${q(label)} has no guidance. One sentence on why this case matters helps the judge and the next author.`,
      );
    } else {
      const n = runeCount(guidance);
      if (n > L.maxGuidanceRunes) {
        this.err(
          'example_guidance_too_long',
          `${path}.guidance`,
          `example ${q(label)} guidance is ${n} characters; the limit is ${L.maxGuidanceRunes}`,
        );
      }
    }
    const notesN = runeCount(this.s(ex, 'notes', path));
    if (notesN > L.maxNotesRunes) {
      this.err(
        'example_notes_too_long',
        `${path}.notes`,
        `example ${q(label)} notes are ${notesN} characters; the limit is ${L.maxNotesRunes}`,
      );
    }

    this.validateTags(path, label, own(ex, 'tags'));

    // weight, min_score, side_effects
    this.validateWeight(`${path}.weight`, label, numberOf(own(ex, 'weight')));
    const minScore = numberOf(own(ex, 'min_score'));
    if (minScore !== undefined && !scoreInRange(minScore)) {
      this.err(
        'example_min_score_range',
        `${path}.min_score`,
        `example ${q(label)} has min_score ${num(minScore)}; use a number from 0 to 1 (0.7 is 7.3 out of 10)`,
      );
    }
    const sideEffects = this.s(ex, 'side_effects', path);
    if (sideEffects !== SIDE_EFFECTS_NONE && !EXAMPLES.sideEffects.has(sideEffects)) {
      this.err(
        'example_side_effects_invalid',
        `${path}.side_effects`,
        `example ${q(label)} has side_effects ${q(sideEffects)}; use refuse or allow`,
      );
    }

    // hold_out on a public flow
    const holdOut = own(ex, 'hold_out') === true;
    if (holdOut && this.isPublic()) {
      this.err(
        'example_holdout_in_public_flow',
        `${path}.hold_out`,
        `example ${q(label)} is held out but this flow is public: a held-out example must stay private, and a public flow's definition is readable by everyone. Make the flow private or remove hold_out.`,
      );
    }

    // input / input_ref
    const hasInput = has(ex, 'input');
    const hasInputRef = has(ex, 'input_ref');
    if (hasInput && hasInputRef) {
      this.err(
        'example_input_conflict',
        path,
        `example ${q(label)} sets both input and input_ref; use exactly one`,
      );
    } else if (!hasInput && !hasInputRef) {
      this.err(
        'example_input_missing',
        path,
        `example ${q(label)} has neither input nor input_ref; use input: {} for a flow that takes no input`,
      );
    }
    const rawInput = own(ex, 'input');
    const baseInput: Rec | null = isRecord(rawInput) ? rawInput : null;
    if (baseInput !== null) {
      this.checkInput(`${path}.input`, label, baseInput, 'example_input_invalid');
    }
    const rawInputRef = own(ex, 'input_ref');
    if (isRecord(rawInputRef)) {
      this.validateFileRef(`${path}.input_ref`, this.fileRefOf(rawInputRef, `${path}.input_ref`));
    }

    // expected
    let binaryOnly = false;
    const expected = own(ex, 'expected');
    if (!has(ex, 'expected')) {
      this.err(
        'example_expected_missing',
        `${path}.expected`,
        `example ${q(label)} does not say what a good result is: add a rubric, fields, exact or reference`,
        SUGGESTION_EXPECTED,
      );
    } else if (isRecord(expected)) {
      this.validateExpectation(`${path}.expected`, label, expected, 'final', '');
      binaryOnly = this.expectationIsBinaryReferenceOnly(expected, `${path}.expected`);
    }
    if (binaryOnly) {
      this.warn(
        'examples_unreadable_by_judge',
        `${path}.expected`,
        'this example can be run but not scored',
      );
    }

    // checkpoints
    this.validateCheckpoints(path, label, own(ex, 'checkpoints'));

    // variants
    this.validateVariants(i, path, label, ex, hasInput, baseInput);

    // credential-shaped literals anywhere in the example
    this.scanSecretLike(i, path, ex);
  }

  private validateTags(path: string, label: string, tags: unknown): void {
    if (!Array.isArray(tags)) return;
    if (tags.length > EXAMPLES.limits.maxTags) {
      this.err(
        'example_tag_invalid',
        `${path}.tags`,
        `example ${q(label)} has ${tags.length} tags; the limit is ${EXAMPLES.limits.maxTags}`,
      );
    }
    const seen = new Set<string>();
    tags.forEach((item: unknown, j: number) => {
      const field = `${path}.tags[${j}]`;
      const tag = item === null ? '' : (this.issues.stringAt(item, field) ?? null);
      if (tag === null) return;
      if (!EXAMPLES.tagPattern.test(tag)) {
        this.err('example_tag_invalid', field, `example ${q(label)} has an invalid tag ${q(tag)}`);
      } else if (seen.has(tag)) {
        this.err(
          'example_tag_invalid',
          field,
          `example ${q(label)} lists the tag ${q(tag)} more than once`,
        );
      }
      seen.add(tag);
    });
  }

  private validateWeight(field: string, label: string, weight: number | undefined): void {
    if (weight === undefined) return;
    if (Number.isNaN(weight) || weight <= 0 || weight > EXAMPLES.limits.weightMax) {
      this.err(
        'example_weight_range',
        field,
        `example ${q(label)} has weight ${num(weight)}; use a number above 0 and at most 10`,
      );
    }
  }

  // -- input ------------------------------------------------------------

  /**
   * Judge one inline input map (an example's `input`, or a variant's patched
   * input). NARROWED relative to the reference, which runs its full value
   * validator: here an unknown field, a missing required field, a value of the
   * wrong KIND and an enum value outside its list are judged; length, range,
   * pattern and date-format constraints are not (PARITY.md).
   */
  private checkInput(field: string, label: string, raw: Rec, code: string): void {
    const input = (normalize(raw, 0) as Rec | null) ?? {};
    const L = EXAMPLES.limits;
    const size = jsonBytes(input);
    if (size !== null && size > L.maxInlineInputBytes) {
      this.err(
        'example_input_too_large',
        field,
        `example ${q(label)} input is ${size} bytes; the limit is ${L.maxInlineInputBytes}. Put the large part behind an https file reference.`,
      );
      return;
    }
    const schema = own(this.flow as Rec, 'input_schema');
    const query = own(this.flow as Rec, 'query');
    if (isRecord(schema)) {
      this.checkInputAgainstSchema(field, label, input, schema, code);
    } else if (isRecord(query) && Object.keys(query).length > 0) {
      const declared = sortedKeys(query);
      for (const k of sortedKeys(input)) {
        if (!Object.prototype.hasOwnProperty.call(query, k)) {
          this.err(
            code,
            `${field}.${k}`,
            `example ${q(label)}: ${q(k)} is not a declared input of this flow (declared: ${declared.join(', ')})`,
          );
        }
      }
    } else {
      this.warn(
        'example_input_unvalidated',
        field,
        `example ${q(label)} cannot be checked: the flow declares no input_schema and no query parameters.`,
      );
    }
  }

  private checkInputAgainstSchema(
    field: string,
    label: string,
    input: Rec,
    schema: Rec,
    code: string,
  ): void {
    const fields = this.schemaFields(schema);
    const byName = new Map<string, SchemaField>();
    for (const f of fields) byName.set(f.name, f);

    // Build the run input: a file reference in a file-typed field becomes
    // {ref: <url>}; a secret-typed value is reported and removed (a secret is
    // never judged — the person running the evaluation supplies it).
    const runInput: Rec = {};
    for (const name of sortedKeys(input)) {
      const val = input[name];
      const f = byName.get(name);
      const present = val !== null && val !== undefined;
      if (f !== undefined && f.type === TYPE_SECRET) {
        if (present) {
          this.err(
            'example_secret_value',
            `${field}.${name}`,
            `example ${q(label)} gives a value for ${q(name)}, which is a secret field. Examples are saved inside the flow and are never allowed to hold secrets; remove it. The person running the evaluation is asked for it at run time.`,
            SUGGESTION_SECRET_VALUE,
          );
        }
        continue;
      }
      if (f !== undefined && f.type === TYPE_FILE && present) {
        const ref = asFileRef(val);
        if (ref === null) {
          this.err(
            'example_file_input_needs_ref',
            `${field}.${name}`,
            `example ${q(label)}: field ${q(name)} is a file; give it as {url: "https://…"}. A pasted upload id would stop working as soon as the session ends.`,
          );
          continue;
        }
        this.validateFileRef(`${field}.${name}`, ref);
        setOwn(runInput, name, { [FILE_REF_KEY]: ref.url });
        continue;
      }
      setOwn(runInput, name, val);
    }

    for (const failure of this.judgeRun(fields, byName, runInput)) {
      // A required secret nobody may supply here is not an error at save: it
      // makes the case needs-secret at run time.
      if (failure.required) {
        const f = byName.get(failure.field);
        if (f !== undefined && f.type === TYPE_SECRET) continue;
      }
      const at = failure.field !== '' ? `${field}.${failure.field}` : field;
      this.err(code, at, `example ${q(label)}: ${failure.message}`);
    }
  }

  private schemaFields(schema: Rec): SchemaField[] {
    const raw = own(schema, 'fields');
    if (!Array.isArray(raw)) return [];
    const out: SchemaField[] = [];
    raw.forEach((f: unknown, i: number) => {
      if (!isRecord(f)) return;
      const base = `input_schema.fields[${i}]`;
      const enumRaw = own(f, 'enum');
      const enumValues: string[] = [];
      if (Array.isArray(enumRaw)) {
        enumRaw.forEach((e: unknown, j: number) => {
          enumValues.push(e === null ? '' : (this.issues.stringAt(e, `${base}.enum[${j}]`) ?? ''));
        });
      }
      const vw = own(f, 'visible_when');
      out.push({
        name: this.s(f, 'name', base),
        type: this.s(f, 'type', base),
        required: own(f, 'required') === true,
        enumValues,
        visibleWhen: isRecord(vw)
          ? {
              field: this.s(vw, 'field', `${base}.visible_when`),
              equals: own(vw, 'equals'),
              in: Array.isArray(own(vw, 'in')) ? (own(vw, 'in') as unknown[]) : [],
            }
          : null,
      });
    });
    return out;
  }

  /** The narrowed run-time judgement: required, kind, enum, unknown field. */
  private judgeRun(
    fields: SchemaField[],
    byName: Map<string, SchemaField>,
    runInput: Rec,
  ): RunFailure[] {
    const failures: RunFailure[] = [];
    for (const f of fields) {
      if (!isVisible(f, runInput)) continue;
      const raw = own(runInput, f.name);
      if (raw === undefined || raw === null) {
        if (f.required) {
          failures.push({
            field: f.name,
            message: `input field ${q(f.name)} is required`,
            required: true,
          });
        }
        continue;
      }
      failures.push(...inputValueFailures(f, raw));
    }
    for (const k of sortedKeys(runInput)) {
      if (!byName.has(k)) {
        failures.push({
          field: k,
          message: `input field ${q(k)} is not declared in input_schema`,
          required: false,
        });
      }
    }
    return failures;
  }

  // -- file reference ---------------------------------------------------

  private fileRefOf(rec: Rec, path: string): FileRef {
    return {
      url: this.s(rec, 'url', path),
      sha256: this.s(rec, 'sha256', path),
      mediaType: this.s(rec, 'media_type', path),
      note: this.s(rec, 'note', path),
    };
  }

  private validateFileRef(field: string, ref: FileRef): void {
    const L = EXAMPLES.limits;
    const raw = ref.url;
    const invalid = 'the file reference needs a url of at most 2048 characters';
    if (raw === '' || byteLen(raw) > L.maxUrlBytes) {
      this.err('example_ref_invalid', field, invalid);
      return;
    }
    const u = goParseURLParts(raw);
    if (u === null) {
      this.err('example_ref_invalid', field, invalid);
      return;
    }
    const scheme = u.scheme.toLowerCase();
    if (EXAMPLES.reservedRefSchemes.has(scheme)) {
      this.err(
        'example_ref_scheme_reserved',
        field,
        `${scheme}: references are not available yet. Use an https URL, or paste the text into the example.`,
      );
      return;
    }
    if (scheme !== SCHEME_HTTPS) {
      this.err(
        'example_ref_scheme',
        field,
        `only https:// references are allowed (got ${q(scheme)})`,
      );
      return;
    }
    if (u.hasUser || u.fragment !== '' || raw.includes('#') || u.host === '') {
      this.err('example_ref_invalid', field, 'a reference must not carry a login or a fragment');
      return;
    }
    // The reference's blocked-host rule (a private or local address) is not
    // ported: it reuses the server's own address tables (PARITY.md).
    if (ref.sha256 !== '' && !EXAMPLES.sha256Pattern.test(ref.sha256)) {
      this.err(
        'example_ref_sha256_invalid',
        field,
        'sha256 must be 64 lowercase hexadecimal characters',
      );
    }
    if (ref.mediaType !== '' && !EXAMPLES.mediaTypePattern.test(ref.mediaType)) {
      this.err(
        'example_ref_media_type_invalid',
        field,
        `media_type ${q(ref.mediaType)} must look like type/subtype`,
      );
    }
    const noteN = runeCount(ref.note);
    if (noteN > L.maxNoteRunes) {
      this.err(
        'example_ref_invalid',
        field,
        `the note is ${noteN} characters; the limit is ${L.maxNoteRunes}`,
      );
    }
    if (ref.sha256 === '') {
      this.warn(
        'example_ref_unpinned',
        field,
        'this reference is not pinned. If the file at that address changes, your scores change with it. Add sha256 to freeze it.',
      );
    }
    for (const key of goQueryKeys(u.rawQuery)) {
      if (EXAMPLES.signedUrlQueryKeyPattern.test(key)) {
        this.warn(
          'example_ref_signed_url',
          field,
          'this address looks like a signed link. Anyone who can read the flow can use it until it expires, and it will stop working. Prefer a stable public address.',
        );
        break;
      }
    }
  }

  // -- expectation ------------------------------------------------------

  /** The names `fields` / `exact` may use, and whether such a list is declared at all. */
  private outputNamesFor(kind: ExpectKind, stepId: string): { names: string[]; declared: boolean } {
    if (kind === 'final') {
      const out = own(this.flow as Rec, 'output');
      const names: string[] = [];
      if (Array.isArray(out)) {
        out.forEach((item: unknown, i: number) => {
          names.push(item === null ? '' : (this.issues.stringAt(item, `output[${i}]`) ?? ''));
        });
      }
      return { names, declared: names.length > 0 };
    }
    const steps = own(this.flow as Rec, 'steps');
    const step = isRecord(steps) ? own(steps, stepId) : undefined;
    const schema = isRecord(step) ? own(step, 'output_schema') : undefined;
    const fields = isRecord(schema) ? own(schema, 'fields') : undefined;
    if (!Array.isArray(fields) || fields.length === 0) return { names: [], declared: false };
    const names: string[] = [];
    fields.forEach((f: unknown, i: number) => {
      if (isRecord(f)) names.push(this.s(f, 'name', `steps.${stepId}.output_schema.fields[${i}]`));
    });
    return { names, declared: true };
  }

  private validateExpectation(
    path: string,
    label: string,
    e: Rec,
    kind: ExpectKind,
    stepId: string,
  ): void {
    const L = EXAMPLES.limits;

    // status
    const status = this.s(e, 'status', path);
    if (status !== '' && !EXAMPLES.statuses.has(status)) {
      this.err(
        'example_status_invalid',
        `${path}.status`,
        'status must be completed, failed or paused_for_human',
      );
    }
    const noOutput = status === STATUS_FAILED || status === STATUS_PAUSED_FOR_HUMAN;
    const fieldsRec = own(e, 'fields');
    const exactRec = own(e, 'exact');
    const fieldKeys = isRecord(fieldsRec) ? sortedKeys(fieldsRec) : [];
    const exactKeys = isRecord(exactRec) ? sortedKeys(exactRec) : [];
    const hasFields = fieldKeys.length > 0;
    const hasExact = exactKeys.length > 0;
    if (hasFields && hasExact) {
      this.err(
        'example_expected_conflict',
        path,
        'use fields (some fields) or exact (the whole result), not both',
      );
    } else if (noOutput && (hasFields || hasExact)) {
      this.err(
        'example_expected_conflict',
        path,
        `a case that ends in ${status} has no output to match; remove fields and exact, or expect status completed`,
      );
    }

    // min_score
    const minScore = numberOf(own(e, 'min_score'));
    if (minScore !== undefined && !scoreInRange(minScore)) {
      this.err(
        'example_min_score_range',
        `${path}.min_score`,
        `min_score ${num(minScore)} is out of range; use a number from 0 to 1`,
      );
    }

    // rubric
    const rubric = this.s(e, 'rubric', path);
    if (rubric !== '') {
      if (goTrimSpace(rubric) === '') {
        this.err(
          'example_rubric_empty',
          `${path}.rubric`,
          'the rubric is empty; write what a good result looks like, or remove it',
        );
      } else {
        const n = runeCount(rubric);
        if (n > L.maxRubricRunes) {
          this.err(
            'example_rubric_too_long',
            `${path}.rubric`,
            `the rubric is ${n} characters; the limit is ${L.maxRubricRunes}`,
          );
        }
      }
    }

    // reference
    const reference = own(e, 'reference');
    if (isRecord(reference)) this.validateReference(`${path}.reference`, reference);

    // fields / exact keys
    const { names, declared } = this.outputNamesFor(kind, stepId);
    const checkKey = (field: string, key: string): void => {
      if (!declared && kind === 'final') {
        this.warn(
          'example_expected_field_unchecked',
          field,
          `this flow declares no output list, so ${q(key)} cannot be checked against it`,
        );
      } else if (!declared) {
        this.warn(
          'example_expected_field_unchecked',
          field,
          `this step declares no output_schema, so ${q(key)} cannot be checked against it`,
        );
      } else if (!names.includes(key)) {
        this.err(
          'example_expected_field_unknown',
          field,
          kind === 'checkpoint'
            ? `${q(key)} is not a field this step declares in its output_schema (declared: ${names.join(', ')})`
            : `${q(key)} is not an output of this flow (outputs: ${names.join(', ')})`,
        );
      }
    };
    for (const key of fieldKeys) {
      const fpath = `${path}.fields.${key}`;
      checkKey(fpath, key);
      const matcher = own(fieldsRec as Rec, key);
      if (isRecord(matcher)) this.validateFieldMatcher(fpath, matcher);
    }
    for (const key of exactKeys) checkKey(`${path}.exact.${key}`, key);

    // must_not / must_not_contain
    const mustNot = this.stringList(own(e, 'must_not'), `${path}.must_not`);
    const mustNotContain = this.stringList(own(e, 'must_not_contain'), `${path}.must_not_contain`);
    const mustNotMsg = `must_not takes up to ${L.maxMustNot} statements of at most ${L.maxMustNotRunes} characters each, none empty`;
    if (mustNot.length > L.maxMustNot) {
      this.err('example_must_not_invalid', `${path}.must_not`, mustNotMsg);
    }
    mustNot.forEach((item, j) => {
      if (goTrimSpace(item) === '' || runeCount(item) > L.maxMustNotRunes) {
        this.err('example_must_not_invalid', `${path}.must_not[${j}]`, mustNotMsg);
      }
    });
    const mncMsg = `must_not_contain takes up to ${L.maxMustNotContain} literals of 1 to ${L.maxMustNotContainLength} characters each`;
    if (mustNotContain.length > L.maxMustNotContain) {
      this.err('example_must_not_contain_invalid', `${path}.must_not_contain`, mncMsg);
    }
    mustNotContain.forEach((item, j) => {
      const n = runeCount(item);
      if (n === 0 || n > L.maxMustNotContainLength) {
        this.err('example_must_not_contain_invalid', `${path}.must_not_contain[${j}]`, mncMsg);
      }
    });
    for (const key of fieldKeys) {
      const matcher = own(fieldsRec as Rec, key);
      if (!isRecord(matcher)) continue;
      const eq = own(matcher, 'equals');
      if (typeof eq !== 'string' || eq === '') continue;
      for (const banned of mustNotContain) {
        if (banned !== '' && equalFold(banned, eq)) {
          this.warn(
            'example_expectation_contradiction',
            `${path}.fields.${key}`,
            `${q(banned)} is required by ${q(key)} and forbidden by must_not_contain`,
          );
        }
      }
    }

    // A checkpoint cannot name a status.
    if (kind === 'checkpoint' && status !== '') {
      this.err(
        'example_checkpoint_status',
        `${path}.status`,
        `example ${q(label)}: a checkpoint cannot set status; status describes how the whole run ends`,
      );
    }

    // checks nothing
    if (
      rubric === '' &&
      !has(e, 'reference') &&
      !hasFields &&
      !hasExact &&
      mustNot.length === 0 &&
      mustNotContain.length === 0 &&
      (status === '' || status === STATUS_COMPLETED)
    ) {
      this.err(
        'example_expected_empty',
        path,
        'this expectation checks nothing; add a rubric, fields, exact, reference, must_not or must_not_contain',
        SUGGESTION_EXPECTED,
      );
    }
  }

  /** A Go `[]string` read: scalars by their text, null as "", anything else dropped. */
  private stringList(v: unknown, path: string): string[] {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    v.forEach((item: unknown, j: number) => {
      if (item === null) out.push('');
      else {
        const t = this.issues.stringAt(item, `${path}[${j}]`);
        if (t !== null) out.push(t);
      }
    });
    return out;
  }

  private validateReference(path: string, r: Rec): void {
    const text = this.s(r, 'text', path);
    const hasText = text !== '';
    const hasRef = has(r, 'ref');
    if (hasText === hasRef) {
      this.err('example_reference_invalid', path, 'a reference needs exactly one of text or ref');
      return;
    }
    if (hasText) {
      const n = byteLen(text);
      if (n > EXAMPLES.limits.maxReferenceTextBytes) {
        this.err(
          'example_reference_invalid',
          path,
          `the reference text is ${n} bytes; the limit is ${EXAMPLES.limits.maxReferenceTextBytes}. Put it behind an https file reference.`,
        );
      }
      return;
    }
    const refRec = own(r, 'ref');
    if (!isRecord(refRec)) return;
    const ref = this.fileRefOf(refRec, `${path}.ref`);
    this.validateFileRef(`${path}.ref`, ref);
    if (ref.mediaType !== '' && !isTextualMediaType(ref.mediaType)) {
      this.warn(
        'example_reference_binary',
        path,
        'this reference is not text, so it cannot be compared in this version; the example will be skipped, not failed.',
      );
    }
  }

  private expectationIsBinaryReferenceOnly(e: Rec, path: string): boolean {
    const reference = own(e, 'reference');
    const refRec = isRecord(reference) ? own(reference, 'ref') : undefined;
    if (!isRecord(refRec)) return false;
    const mediaType = this.s(refRec, 'media_type', `${path}.reference.ref`);
    if (mediaType === '' || isTextualMediaType(mediaType)) return false;
    const status = this.s(e, 'status', path);
    const fields = own(e, 'fields');
    const exact = own(e, 'exact');
    return (
      this.s(e, 'rubric', path) === '' &&
      !(isRecord(fields) && Object.keys(fields).length > 0) &&
      !(isRecord(exact) && Object.keys(exact).length > 0) &&
      this.stringList(own(e, 'must_not'), `${path}.must_not`).length === 0 &&
      this.stringList(own(e, 'must_not_contain'), `${path}.must_not_contain`).length === 0 &&
      (status === '' || status === STATUS_COMPLETED)
    );
  }

  private validateFieldMatcher(path: string, m: Rec): void {
    const L = EXAMPLES.limits;
    const matches = this.s(m, 'matches', path);
    const oneOf = own(m, 'one_of');
    const approx = numberOf(own(m, 'approx'));
    const tolerance = numberOf(own(m, 'tolerance'));
    let operators = 0;
    if (has(m, 'equals')) operators++;
    if (this.s(m, 'contains', path) !== '') operators++;
    if (this.s(m, 'not_contains', path) !== '') operators++;
    if (matches !== '') operators++;
    if (Array.isArray(oneOf) && oneOf.length > 0) operators++;
    if (approx !== undefined) operators++;
    if (typeof own(m, 'present') === 'boolean') operators++;
    if (operators !== 1) {
      this.err(
        'example_field_matcher_invalid',
        path,
        'write exactly one of equals, contains, not_contains, matches, one_of, approx, present',
      );
      return;
    }
    // Only the length is judged: whether a pattern COMPILES is a question for
    // the reference's regular-expression engine, which this port is not.
    if (matches !== '' && byteLen(matches) > L.maxPatternLength) {
      this.err(
        'example_field_matcher_invalid',
        path,
        `the pattern in matches must be a valid regular expression of at most ${L.maxPatternLength} characters`,
      );
    }
    // approx needs its tolerance, and tolerance belongs to approx alone.
    if (
      (approx !== undefined) !== (tolerance !== undefined) ||
      (tolerance !== undefined && (Number.isNaN(tolerance) || tolerance < 0))
    ) {
      this.err(
        'example_field_matcher_invalid',
        path,
        'approx needs a tolerance (a number, zero or more) beside it, and tolerance is only for approx',
      );
    }
  }

  // -- checkpoints ------------------------------------------------------

  private validateCheckpoints(path: string, label: string, cps: unknown): void {
    if (!isRecord(cps) || Object.keys(cps).length === 0) return;
    const stepsRaw = own(this.flow as Rec, 'steps');
    const steps: Rec = isRecord(stepsRaw) ? stepsRaw : {};
    const stepIds = sortedKeys(steps);
    for (const id of sortedKeys(cps)) {
      const cpath = `${path}.checkpoints.${id}`;
      const step = own(steps, id);
      if (!isRecord(step)) {
        this.err(
          'example_checkpoint_step_unknown',
          cpath,
          `example ${q(label)}: checkpoint ${q(id)} is not a step of this flow (steps: ${stepIds.join(', ')})`,
          SUGGESTION_CHECKPOINT,
        );
        continue;
      }
      const next = own(step, 'next');
      if (has(step, 'for_each') || has(step, 'loop') || (isRecord(next) && has(next, 'parallel'))) {
        this.err(
          'example_checkpoint_step_composite',
          cpath,
          `example ${q(label)}: step ${q(id)} repeats or branches, so there is no single result to check; put the checkpoint on a plain step or check the final output`,
        );
        continue;
      }
      const cp = own(cps, id);
      if (cp === null || cp === undefined) {
        this.validateExpectation(cpath, label, {}, 'checkpoint', id);
      } else if (isRecord(cp)) {
        this.validateExpectation(cpath, label, cp, 'checkpoint', id);
      }
    }
  }

  // -- variants ---------------------------------------------------------

  private validateVariants(
    i: number,
    path: string,
    label: string,
    ex: Rec,
    hasInput: boolean,
    baseInput: Rec | null,
  ): void {
    const L = EXAMPLES.limits;
    const variants = own(ex, 'variants');
    if (!Array.isArray(variants) || variants.length === 0) return;
    if (variants.length > L.maxVariants) {
      this.err(
        'example_variants_too_many',
        `${path}.variants`,
        `example ${q(label)} has ${variants.length} variants; the limit is ${L.maxVariants}`,
      );
    }
    const seen = new Set<string>();
    variants.forEach((v: unknown, j: number) => {
      if (!isRecord(v)) return;
      const vpath = `examples[${i}].variants[${j}]`;
      const vid = this.s(v, 'id', vpath);
      const vlabel = vid === '' ? `#${j + 1}` : vid;
      const both = `${label}/${vlabel}`;

      if (!EXAMPLES.idPattern.test(vid)) {
        this.err(
          'example_variant_id_invalid',
          `${vpath}.id`,
          `variant id ${q(vid)} of example ${q(label)} is not valid: use lower-case letters, digits and underscores, starting with a letter (2 to 48 characters)`,
          SUGGESTION_ID,
        );
      } else if (seen.has(vid)) {
        this.err(
          'example_variant_id_duplicate',
          `${vpath}.id`,
          `variant id ${q(vid)} is used twice in example ${q(label)}`,
        );
      }
      seen.add(vid);

      const origin = this.s(v, 'origin', vpath);
      if (origin === ORIGIN_NONE || !EXAMPLES.origins.has(origin)) {
        this.err(
          'example_variant_origin_invalid',
          `${vpath}.origin`,
          `variant ${q(vlabel)} of example ${q(label)} has origin ${q(origin)}; use author (a person wrote or approved it) or synthetic (generated)`,
        );
      }
      const vtitleN = runeCount(this.s(v, 'title', vpath));
      if (vtitleN > L.titleMaxRunes) {
        this.err(
          'example_title_too_long',
          `${vpath}.title`,
          `example ${q(both)} title is ${vtitleN} characters; the limit is ${L.titleMaxRunes}`,
        );
      }
      const vguidanceN = runeCount(this.s(v, 'guidance', vpath));
      if (vguidanceN > L.maxGuidanceRunes) {
        this.err(
          'example_guidance_too_long',
          `${vpath}.guidance`,
          `example ${q(both)} guidance is ${vguidanceN} characters; the limit is ${L.maxGuidanceRunes}`,
        );
      }
      const provN = runeCount(this.s(v, 'provenance', vpath));
      if (provN > L.maxProvenanceRunes) {
        this.err(
          'example_notes_too_long',
          `${vpath}.provenance`,
          `example ${q(both)} notes are ${provN} characters; the limit is ${L.maxProvenanceRunes}`,
        );
      }
      this.validateWeight(`${vpath}.weight`, both, numberOf(own(v, 'weight')));

      const patch = own(v, 'input_patch');
      const patchRec: Rec | null = isRecord(patch) ? patch : null;
      const hasPatch = patchRec !== null && Object.keys(patchRec).length > 0;
      const hasRef = has(v, 'input_ref');
      if (hasPatch && hasRef) {
        this.err(
          'example_variant_input_conflict',
          vpath,
          `variant ${q(vlabel)} of example ${q(label)} sets both input_patch and input_ref; use one`,
        );
      } else if (!hasPatch && !hasRef && !has(v, 'expected')) {
        this.err(
          'example_variant_empty',
          vpath,
          `variant ${q(vlabel)} of example ${q(label)} changes neither the input nor the expectation`,
        );
      }
      const refRec = own(v, 'input_ref');
      if (isRecord(refRec)) {
        this.validateFileRef(`${vpath}.input_ref`, this.fileRefOf(refRec, `${vpath}.input_ref`));
      }
      if (hasPatch && patchRec !== null) {
        if (!hasInput) {
          this.warn(
            'example_variant_unchecked',
            `${vpath}.input_patch`,
            `variant ${q(vlabel)} of example ${q(label)} cannot be checked: its parent takes its input from input_ref.`,
          );
        } else if (baseInput !== null) {
          this.checkVariantPatch(vpath, label, vlabel, baseInput, patchRec);
        }
      }
      const expected = own(v, 'expected');
      if (isRecord(expected)) {
        this.validateExpectation(`${vpath}.expected`, both, expected, 'final', '');
      }
    });
  }

  /**
   * Judge the PATCHED input like a live run, and report a secret the patch
   * itself supplies. A null patch value deleting a secret is fine.
   */
  private checkVariantPatch(
    vpath: string,
    label: string,
    vlabel: string,
    base: Rec,
    patch: Rec,
  ): void {
    const schema = own(this.flow as Rec, 'input_schema');
    if (isRecord(schema)) {
      for (const f of this.schemaFields(schema)) {
        if (f.type !== TYPE_SECRET) continue;
        const val = own(patch, f.name);
        if (val !== undefined && val !== null) {
          this.err(
            'example_secret_value',
            `${vpath}.input_patch.${f.name}`,
            `example ${q(`${label}/${vlabel}`)} gives a value for ${q(f.name)}, which is a secret field. Examples are saved inside the flow and are never allowed to hold secrets; remove it. The person running the evaluation is asked for it at run time.`,
            SUGGESTION_SECRET_VALUE,
          );
        }
      }
    }
    const patched = applyExamplePatch(base, patch);
    // A scratch walker, so the variant wording replaces the example wording and
    // the parent's own secret findings are not reported twice.
    const scratch = new Walker(this.flow, this.issues);
    scratch.checkInput(
      `${vpath}.input_patch`,
      `${label}/${vlabel}`,
      patched,
      'example_variant_input_invalid',
    );
    for (const f of scratch.findings) {
      if (f.code === 'example_secret_value') continue;
      this.findings.push(f);
    }
  }

  // -- credential-shaped literals ----------------------------------------

  private scanSecretLike(i: number, path: string, ex: Rec): void {
    const emit = (field: string, s: string): void => {
      const name = secretMatch(s);
      if (name !== '') {
        this.err(
          'example_secret_like_value',
          field,
          `${field} looks like a credential (${name}). Examples are saved in the flow definition and must never contain keys or tokens. Replace it with a made-up value.`,
          SUGGESTION_SECRET_VALUE,
        );
      }
    };
    emit(`${path}.title`, this.s(ex, 'title', path));
    emit(`${path}.guidance`, this.s(ex, 'guidance', path));
    emit(`${path}.notes`, this.s(ex, 'notes', path));
    const input = own(ex, 'input');
    if (isRecord(input)) scanLeaves(`${path}.input`, input, 0, emit);
    const expected = own(ex, 'expected');
    if (isRecord(expected)) this.scanExpectationLeaves(`${path}.expected`, expected, emit);
    const cps = own(ex, 'checkpoints');
    if (isRecord(cps)) {
      for (const id of sortedKeys(cps)) {
        const cp = own(cps, id);
        if (isRecord(cp)) this.scanExpectationLeaves(`${path}.checkpoints.${id}`, cp, emit);
      }
    }
    const variants = own(ex, 'variants');
    if (Array.isArray(variants)) {
      variants.forEach((v: unknown, j: number) => {
        if (!isRecord(v)) return;
        const vpath = `examples[${i}].variants[${j}]`;
        emit(`${vpath}.title`, this.s(v, 'title', vpath));
        emit(`${vpath}.guidance`, this.s(v, 'guidance', vpath));
        emit(`${vpath}.provenance`, this.s(v, 'provenance', vpath));
        scanLeaves(`${vpath}.input_patch`, own(v, 'input_patch'), 0, emit);
        const vexp = own(v, 'expected');
        if (isRecord(vexp)) this.scanExpectationLeaves(`${vpath}.expected`, vexp, emit);
      });
    }
  }

  private scanExpectationLeaves(
    path: string,
    e: Rec,
    emit: (field: string, s: string) => void,
  ): void {
    emit(`${path}.rubric`, this.s(e, 'rubric', path));
    const reference = own(e, 'reference');
    if (isRecord(reference)) {
      emit(`${path}.reference.text`, this.s(reference, 'text', `${path}.reference`));
    }
    this.stringList(own(e, 'must_not'), `${path}.must_not`).forEach((s, j) =>
      emit(`${path}.must_not[${j}]`, s),
    );
    this.stringList(own(e, 'must_not_contain'), `${path}.must_not_contain`).forEach((s, j) =>
      emit(`${path}.must_not_contain[${j}]`, s),
    );
    const fields = own(e, 'fields');
    if (isRecord(fields)) {
      for (const key of sortedKeys(fields)) {
        const m = own(fields, key);
        if (!isRecord(m)) continue;
        const fpath = `${path}.fields.${key}`;
        scanLeaves(`${fpath}.equals`, own(m, 'equals'), 0, emit);
        emit(`${fpath}.contains`, this.s(m, 'contains', fpath));
        emit(`${fpath}.not_contains`, this.s(m, 'not_contains', fpath));
        const oneOf = own(m, 'one_of');
        if (Array.isArray(oneOf)) {
          oneOf.forEach((one: unknown, j: number) =>
            scanLeaves(`${fpath}.one_of[${j}]`, one, 0, emit),
          );
        }
      }
    }
    scanLeaves(`${path}.exact`, own(e, 'exact'), 0, emit);
  }
}

// ---------------------------------------------------------------------------
// Free helpers
// ---------------------------------------------------------------------------

interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  enumValues: string[];
  visibleWhen: { field: string; equals: unknown; in: unknown[] } | null;
}

interface RunFailure {
  field: string;
  message: string;
  /** The failure is "required field missing" (a required secret is then not an error). */
  required: boolean;
}

function scoreInRange(v: number): boolean {
  return !Number.isNaN(v) && v >= EXAMPLES.limits.minScoreMin && v <= EXAMPLES.limits.minScoreMax;
}

/** Go's `strings.EqualFold`, by simple case folding of each code point. */
function equalFold(a: string, b: string): boolean {
  const ca = [...a];
  const cb = [...b];
  if (ca.length !== cb.length) return false;
  return ca.every((c, i) => {
    const d = cb[i] as string;
    return c === d || c.toLowerCase() === d.toLowerCase() || c.toUpperCase() === d.toUpperCase();
  });
}

/** The name of the first credential shape `s` resembles, or "". */
function secretMatch(s: string): string {
  for (const p of EXAMPLES.secretPatterns) {
    if (p.re.test(s)) return p.name;
  }
  return '';
}

function scanLeaves(
  path: string,
  v: unknown,
  depth: number,
  emit: (field: string, s: string) => void,
): void {
  if (depth > MAX_RECURSION_DEPTH) return;
  if (isRecord(v)) {
    for (const k of sortedKeys(v)) scanLeaves(`${path}.${k}`, v[k], depth + 1, emit);
    return;
  }
  if (typeof v === 'string') emit(path, v);
  else if (Array.isArray(v)) {
    v.forEach((item: unknown, i: number) => scanLeaves(`${path}[${i}]`, item, depth + 1, emit));
  }
}

/** The byte length of a value's JSON, or null where it cannot be encoded. */
function jsonBytes(v: unknown): number | null {
  try {
    const text = JSON.stringify(v);
    return text === undefined ? null : byteLen(text);
  } catch {
    return null;
  }
}

/**
 * The size of the whole block as JSON, measured the way the reference measures
 * its typed structs: empty values are omitted. Measured over the raw document
 * with empties dropped, so it is never larger than the reference's count.
 */
function blockBytes(examples: unknown[]): number | null {
  try {
    const text = JSON.stringify(normalize(examples, 0), function (this: unknown, _k, v: unknown) {
      if (Array.isArray(this)) return v;
      if (v === null || v === '' || v === false) return undefined;
      if (Array.isArray(v) && v.length === 0) return undefined;
      return v;
    });
    return text === undefined ? null : byteLen(text);
  } catch {
    return null;
  }
}

function isVisible(f: SchemaField, input: Rec): boolean {
  const vw = f.visibleWhen;
  if (vw === null) return true;
  if (!Object.prototype.hasOwnProperty.call(input, vw.field)) return false;
  const dep = input[vw.field];
  if (vw.equals !== undefined && vw.equals !== null) return valuesEqual(dep, vw.equals);
  return vw.in.some((candidate) => valuesEqual(dep, candidate));
}

/** Cross-kind matches are not equal: `true` is never `"true"`. */
function valuesEqual(a: unknown, b: unknown): boolean {
  const aNil = a === null || a === undefined;
  const bNil = b === null || b === undefined;
  if (aNil || bNil) return aNil && bNil;
  if (typeof a === 'number') return typeof b === 'number' && a === b;
  if (typeof a === 'boolean') return typeof b === 'boolean' && a === b;
  if (typeof a === 'string') return typeof b === 'string' && a === b;
  return false;
}

function mismatch(f: SchemaField, expected: string): RunFailure {
  return {
    field: f.name,
    message: `input field ${q(f.name)} is not a valid ${expected}`,
    required: false,
  };
}

/** The narrowed kind / enum judgement of one present value. */
function inputValueFailures(f: SchemaField, raw: unknown): RunFailure[] {
  switch (f.type) {
    case TYPE_STRING:
    case TYPE_MULTILINE:
    case TYPE_SECRET:
      return typeof raw === 'string' ? [] : [mismatch(f, TYPE_STRING)];
    case TYPE_NUMBER:
      // Any YAML number: the reference also takes NaN and the infinities here.
      return typeof raw === 'number' ? [] : [mismatch(f, TYPE_NUMBER)];
    case TYPE_BOOL:
      return typeof raw === 'boolean' ? [] : [mismatch(f, TYPE_BOOL)];
    case TYPE_ENUM:
      if (typeof raw !== 'string') return [mismatch(f, TYPE_ENUM)];
      if (f.enumValues.includes(raw)) return [];
      return [
        {
          field: f.name,
          message: `input field ${q(f.name)} value ${q(raw)} is not one of [${f.enumValues.join(',')}]`,
          required: false,
        },
      ];
    case TYPE_ARRAY_OF_STRINGS: {
      if (!Array.isArray(raw)) return [mismatch(f, TYPE_ARRAY_OF_STRINGS)];
      const out: RunFailure[] = [];
      raw.forEach((item: unknown, i: number) => {
        if (typeof item !== 'string') {
          out.push({
            field: f.name,
            message: `input field ${q(f.name)} index ${i} is not a string`,
            required: false,
          });
        }
      });
      return out;
    }
    case TYPE_DATE:
      // Kind only: the YYYY-MM-DD shape and the calendar are not judged here.
      return typeof raw === 'string' ? [] : [mismatch(f, TYPE_DATE)];
    case TYPE_FILE: {
      if (typeof raw === 'string') return raw === '' ? [mismatch(f, TYPE_FILE)] : [];
      if (isRecord(raw)) {
        const ref = own(raw, FILE_REF_KEY);
        return typeof ref === 'string' && ref !== '' ? [] : [mismatch(f, TYPE_FILE)];
      }
      return [mismatch(f, TYPE_FILE)];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/**
 * Judge the flow's `examples:` block. An absent or empty block is no findings:
 * every flow that predates the grammar is unchanged.
 */
export function validateExamples(flow: Flow, issues: Issues): void {
  const examples = (flow as Rec)[KEY_EXAMPLES];
  if (!Array.isArray(examples) || examples.length === 0) return;
  const walker = new Walker(flow, issues);
  walker.run(examples);
  for (const f of walker.findings) {
    const issue = {
      field: f.field,
      message: f.message,
      code: f.code,
      ...(f.suggestion !== undefined ? { suggestion: f.suggestion } : {}),
    };
    if (f.severity === 'error') issues.error(issue);
    else issues.warn(issue);
  }
}

/** Every severity the walker emits, by code — held to the spec's table by a test. */
export function exampleCodeSeverities(): Readonly<Record<string, Severity>> {
  return EXAMPLES.codes;
}
