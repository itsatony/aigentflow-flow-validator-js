// Finds the field chains of a Go template that are rooted at the template's dot.
//
// `{{ .data.ask.response }}` is the chain [data ask response]. The reference walks
// Go's parse tree (`walkRootFieldChains`, validation.humananswer.go); this port has
// no parse tree, so it runs a small tokenizer over each `{{ ... }}` action, like
// gotmpl-default.ts, and follows the block structure with a stack:
//
// - `range` and `with` rebind the dot, so their BODIES (and their `else`
//   branches, which the reference does not walk either) are not judged; their
//   controlling pipeline is.
// - `if` does not rebind the dot: its pipeline, body, `else if` pipelines and
//   `else` branch are judged when the `if` itself is.
// - Go accepts `else if` only in an `if` and `else with` only in a `with`; any
//   other `else <keyword>` does not parse, and the reference judges no template
//   that does not parse, so such a template yields no chain at all.
// - `define` and `block` bodies are separate templates the reference walks too.
//
// Only a `.` that starts a word is a root field: `$.data` and `$x.data` are
// variables, `(expr).data` is a chain off a non-root base, `1.5` is a number.
// Strings, raw strings, character literals and comments are skipped. A chain
// whose text the tokenizer cannot read as identifiers is dropped, never guessed:
// the rules built on this are warnings whose risk is a false positive.

import { lexActions, scanString } from './gotmpl-syntax.js';

/** Words the action opens with that end the current block, or carry no pipeline. */
const END = /^end(?![\w$.])/;
const NO_PIPELINE = /^(?:break|continue)(?![\w$.])/;
const DEFINE = /^define(?![\w$.])/;
const BLOCK_OR_TEMPLATE = /^(block|template)(?![\w$.])/;
const ELSE = /^else(?![\w$.])/;
const IF = /^if(?![\w$.])/;
const RANGE_OR_WITH = /^(range|with)(?![\w$.])/;
/** Any word after `else`: only `if` (in an `if`) and `with` (in a `with`) parse. */
const ELSE_KEYWORD = /^([A-Za-z_]\w*)/;

/** A character after which a `.` starts a ROOT field (whitespace, `(`, `|`, `=`, `,`). */
const ROOT_PRECEDER = /[\s(|=,]/;
/** One field name: a Go identifier (a letter or `_`, then letters, digits, `_`). */
const IDENTIFIER = /^[\p{L}_][\p{L}\p{Nd}_]*/u;
/** A character that may legally follow a field chain inside a pipeline. */
const CHAIN_FOLLOWER = /[\s()|]/;

interface Frame {
  kind: 'if' | 'range' | 'with' | 'define';
  /** Whether a root field in this block's current branch is judged. */
  judged: boolean;
}

/** Returns every root field chain of `src`, in source order (duplicates kept). */
export function rootFieldChains(src: string): string[][] {
  const { actions, fatal } = lexActions(src);
  if (fatal) return [];
  const chains: string[][] = [];
  const frames: Frame[] = [];
  const judged = (): boolean => (frames.length === 0 ? true : frames[frames.length - 1]!.judged);

  for (const action of actions) {
    if (action.isComment || action.body === '') continue;
    const body = action.body;
    if (END.test(body)) {
      frames.pop();
      continue;
    }
    if (NO_PIPELINE.test(body)) continue;
    if (DEFINE.test(body)) {
      frames.push({ kind: 'define', judged: true });
      continue;
    }
    const named = BLOCK_OR_TEMPLATE.exec(body);
    if (named) {
      if (judged()) scanPipeline(skipTemplateName(body.slice(named[0].length)), chains);
      // A block's body is a defined template, walked on its own.
      if (named[1] === 'block') frames.push({ kind: 'define', judged: true });
      continue;
    }
    if (ELSE.test(body)) {
      const top = frames[frames.length - 1];
      if (!top) continue;
      const rest = body.slice('else'.length).trimStart();
      const keyword = ELSE_KEYWORD.exec(rest)?.[1];
      if (keyword === undefined) continue; // A plain `else`: the frame's judgement stands.
      if (keyword !== top.kind || (keyword !== 'if' && keyword !== 'with')) return [];
      // `else if` keeps an `if` judged; a `with` (and its `else with`) is never.
      if (top.judged) scanPipeline(rest.slice(keyword.length), chains);
      continue;
    }
    if (IF.test(body)) {
      if (judged()) scanPipeline(body.slice('if'.length), chains);
      frames.push({ kind: 'if', judged: judged() });
      continue;
    }
    const rw = RANGE_OR_WITH.exec(body);
    if (rw) {
      if (judged()) scanPipeline(body.slice(rw[0].length), chains);
      frames.push({ kind: rw[1] as 'range' | 'with', judged: false });
      continue;
    }
    if (judged()) scanPipeline(body, chains);
  }
  return chains;
}

/** Drops the quoted template name that opens a `template` / `block` action. */
function skipTemplateName(rest: string): string {
  const trimmed = rest.trimStart();
  const q = trimmed[0];
  if (q !== '"' && q !== '`') return trimmed;
  const end = scanString(trimmed, 0, q);
  return end === -1 ? '' : trimmed.slice(end + 1);
}

/** Records every root field chain of one pipeline's text. */
function scanPipeline(src: string, chains: string[][]): void {
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i] as string;
    if (c === '"' || c === '`' || c === "'") {
      const end = scanString(src, i, c);
      if (end === -1) return;
      i = end + 1;
      continue;
    }
    if (c === '.' && (i === 0 || ROOT_PRECEDER.test(src[i - 1] as string))) {
      const read = readChain(src, i);
      if (read.chain) chains.push(read.chain);
      i = read.end;
      continue;
    }
    i += 1;
  }
}

/** Reads `.a.b.c` at `start`; `chain` is undefined when it is not a clean field chain. */
function readChain(src: string, start: number): { chain?: string[]; end: number } {
  const chain: string[] = [];
  let i = start;
  while (src[i] === '.') {
    const m = IDENTIFIER.exec(src.slice(i + 1));
    if (!m) break;
    chain.push(m[0]);
    i += 1 + m[0].length;
  }
  // Skip the rest of this word whatever it is, so its tail is never read as a root field.
  let end = i;
  while (end < src.length && !CHAIN_FOLLOWER.test(src[end] as string)) end += 1;
  if (chain.length === 0 || end !== i) return { end: Math.max(end, start + 1) };
  return { chain, end };
}
