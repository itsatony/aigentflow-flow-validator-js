// Detects a value PIPED into the template function `default`.
//
// `default` takes the value first (`default .x "fallback"`). A pipe hands the
// piped value to the LAST parameter, so `{{ .x | default "w" }}` is
// `default "w" .x`: the literal is the "value", it is never empty, and the
// result is always the fallback. Nothing fails at run time, the data is simply
// never used.
//
// The reference walks Go's parse tree. This port has no parse tree, so it runs
// a small tokenizer over each `{{ ... }}` action instead — never a regex over
// the raw text. It respects string, raw-string and character literals and
// comments, splits a pipeline on top-level `|`, recurses into parentheses, and
// recognises the pipeline of `if` / `else if` / `range` / `with` / `template` /
// `block` actions and of a `$v :=` declaration. Only a bare identifier `default`
// in command position counts; a field (`.query.default`), a variable
// (`$default`) and a literal never do. Known limits are in PARITY.md.

import { lexActions, scanString } from './gotmpl-syntax.js';

const FUNCTION_NAME = 'default';
const PIPE = '|';
const OPEN_PAREN = '(';
const CLOSE_PAREN = ')';
/**
 * Parenthesis nesting past which a pipeline is left unexamined. The validator runs on untrusted
 * flow documents (browser, CLI, a service), and a template of thousands of `(` would otherwise
 * overflow the stack; Go's own template parser caps nesting too, so such a template never
 * runs. Real templates nest a handful of levels.
 */
const MAX_NESTING_DEPTH = 100;

/** Control keywords whose remainder is a pipeline (longest first). */
const PIPELINE_KEYWORDS = /^(?:else\s+if|else\s+with|if|range|with|template|block)(?![\w$.])/;
/** `define "name"` carries no pipeline; neither does a bare `else`/`end`. */
const NO_PIPELINE = /^(?:define|else|end|break|continue)(?![\w$.])/;
/** A variable declaration or assignment that opens a pipeline. */
const DECLARATION = /^\$\w*(?:\s*,\s*\$\w*)*\s*:?=/;

interface Parsed {
  /** Printed form of the pipeline just parsed. */
  text: string;
  /** Index just past what was consumed. */
  end: number;
}

/** Returns the sorted, de-duplicated pipelines of `src` that pipe into `default`. */
export function pipedDefaultPipelines(src: string): string[] {
  const { actions, fatal } = lexActions(src);
  if (fatal) return [];
  const found = new Set<string>();
  try {
    for (const action of actions) {
      if (action.isComment || action.body === '') continue;
      scanAction(action.body, found);
    }
  } catch (err) {
    // A rule must never take the validator down: a template this module cannot walk is simply
    // not examined (the syntax check has its own say about it).
    if (!(err instanceof RangeError)) throw err;
    return [];
  }
  return [...found].sort();
}

function scanAction(body: string, found: Set<string>): void {
  let rest = body;
  const kw = PIPELINE_KEYWORDS.exec(rest);
  if (!kw && NO_PIPELINE.test(rest)) return;
  if (kw) {
    rest = rest.slice(kw[0].length).trimStart();
    const keyword = kw[0].replace(/\s+/g, ' ');
    if (keyword === 'template' || keyword === 'block') {
      // Skip the template name literal; the remainder is the pipeline.
      const q = rest[0];
      if (q === '"' || q === '`') {
        const end = scanString(rest, 0, q);
        if (end === -1) return;
        rest = rest.slice(end + 1).trimStart();
      }
    }
  }
  if (rest === '') return;
  parsePipeline(rest, 0, false, found, 0);
}

/**
 * Parses one pipeline starting at `start`; when `nested`, stops after the `)`
 * that closes it. Every pipeline met on the way (this one and any parenthesised
 * one) is checked and recorded in `found`.
 */
function parsePipeline(
  src: string,
  start: number,
  nested: boolean,
  found: Set<string>,
  depth: number,
): Parsed {
  if (depth > MAX_NESTING_DEPTH) return { text: src.slice(start), end: src.length };
  let i = start;
  const n = src.length;
  let decl = '';
  const decMatch = DECLARATION.exec(src.slice(i));
  if (decMatch) {
    decl = decMatch[0].replace(/\s+/g, ' ') + ' ';
    i += decMatch[0].length;
  }

  const commands: string[][] = [];
  let current: string[] = [];
  let firstWords: string[] = [];
  let pipedDefault = false;
  const pushCommand = (): void => {
    if (current.length > 0) {
      commands.push(current);
      firstWords.push(current[0] as string);
    }
    current = [];
  };

  while (i < n) {
    const c = src[i] as string;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
      continue;
    }
    if (c === '"' || c === '`' || c === "'") {
      const end = scanString(src, i, c);
      const stop = end === -1 ? n - 1 : end;
      current.push(src.slice(i, stop + 1));
      i = stop + 1;
      continue;
    }
    if (c === OPEN_PAREN) {
      const inner = parsePipeline(src, i + 1, true, found, depth + 1);
      current.push(`(${inner.text})`);
      i = inner.end;
      continue;
    }
    if (c === CLOSE_PAREN) {
      if (nested) {
        i += 1;
        break;
      }
      i += 1; // stray: tolerate
      continue;
    }
    if (c === PIPE) {
      pushCommand();
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && !/[\s|()"`']/.test(src[j] as string)) j += 1;
    if (j === i) j = i + 1;
    current.push(src.slice(i, j));
    i = j;
  }
  pushCommand();

  firstWords.forEach((word, idx) => {
    if (idx > 0 && word === FUNCTION_NAME) pipedDefault = true;
  });
  const text = decl + commands.map((cmd) => cmd.join(' ')).join(` ${PIPE} `);
  if (pipedDefault) found.add(text);
  return { text, end: i };
}
