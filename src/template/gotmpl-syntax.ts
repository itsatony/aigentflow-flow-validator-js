// Focused syntax checker for Go `text/template` source.
//
// This is NOT a renderer and NOT a full parser. It reproduces the subset of
// Go's `template.Parse` *syntax* failures that matter for static flow
// validation, with a deliberate bias against false positives:
//
//   1. Unclosed `{{` action delimiters (respecting quoted strings + comments).
//   2. Control-flow nesting balance: if / range / with / block / define must
//      each be closed by `end`; `else` must sit inside if / with / range.
//   3. Empty actions (`{{}}`).
//   4. (opt-in) Unknown function names in command position.
//
// Stray `}}` in text is NOT an error (Go treats it as literal text), matching
// the reference behaviour. Field/variable/literal pipelines are intentionally
// not deeply parsed — that would invite false positives without catching bugs
// a flow author cares about at authoring time.

/** A single Go-template syntax problem. */
export interface TemplateSyntaxError {
  message: string;
  /** When true, this came from the opt-in function allow-list pass. */
  isFunctionError?: boolean;
}

export interface TemplateCheckOptions {
  /** Function names recognised by the AIgentFlow template engine. */
  knownFunctions?: ReadonlySet<string>;
  /** When true, an unknown command-position function name is reported. */
  strictFunctions?: boolean;
}

const BLOCK_OPENERS = new Set(['if', 'range', 'with', 'block', 'define']);
const ELSE_CONTEXTS = new Set(['if', 'range', 'with']);
const KEYWORDS = new Set(['if', 'range', 'with', 'block', 'define', 'template', 'else', 'end']);
const LITERALS = new Set(['true', 'false', 'nil']);

interface Action {
  /** Raw inner text between the delimiters (trim markers stripped). */
  body: string;
  /** True for comment actions (the Go `comment` action form). */
  isComment: boolean;
}

/**
 * Split template source into actions, respecting quoted strings and comments.
 * Returns the actions plus a fatal error if a `{{` is never closed.
 */
function lexActions(src: string): { actions: Action[]; fatal?: TemplateSyntaxError } {
  const actions: Action[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const open = src.indexOf('{{', i);
    if (open === -1) break;

    let j = open + 2;
    // Optional left-trim marker `{{-`.
    if (src[j] === '-') j += 1;

    // Comment action: `{{/* ... */}}`.
    const afterWs = skipSpaces(src, j);
    if (src.startsWith('/*', afterWs)) {
      const closeComment = src.indexOf('*/', afterWs + 2);
      if (closeComment === -1) {
        return { actions, fatal: { message: 'unclosed comment in action: missing "*/"' } };
      }
      let k = skipSpaces(src, closeComment + 2);
      if (src[k] === '-') k += 1;
      if (!src.startsWith('}}', k)) {
        return {
          actions,
          fatal: { message: 'unclosed action delimiter: expected "}}" after comment' },
        };
      }
      actions.push({ body: '', isComment: true });
      i = k + 2;
      continue;
    }

    // Scan for the closing `}}`, skipping over quoted strings.
    let k = j;
    let closed = -1;
    while (k < n) {
      const c = src[k];
      if (c === '"' || c === '`' || c === "'") {
        const end = scanString(src, k, c);
        if (end === -1) {
          return {
            actions,
            fatal: { message: `unterminated string in action: missing closing ${c}` },
          };
        }
        k = end + 1;
        continue;
      }
      if (c === '}' && src[k + 1] === '}') {
        closed = k;
        break;
      }
      k += 1;
    }
    if (closed === -1) {
      return { actions, fatal: { message: 'unclosed action delimiter "{{"' } };
    }

    let bodyEnd = closed;
    // Strip right-trim marker ` -}}` → the `-` immediately before `}}`.
    if (src[bodyEnd - 1] === '-') bodyEnd -= 1;
    const body = src.slice(j, bodyEnd).trim();
    actions.push({ body, isComment: false });
    i = closed + 2;
  }

  return { actions };
}

function skipSpaces(src: string, idx: number): number {
  let i = idx;
  while (
    i < src.length &&
    (src[i] === ' ' || src[i] === '\t' || src[i] === '\n' || src[i] === '\r')
  ) {
    i += 1;
  }
  return i;
}

/** Returns the index of the closing quote, or -1 if unterminated. */
function scanString(src: string, start: number, quote: string): number {
  let i = start + 1;
  const raw = quote === '`'; // backtick raw strings have no escapes
  while (i < src.length) {
    const c = src[i];
    if (!raw && c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i;
    i += 1;
  }
  return -1;
}

/** First whitespace-delimited token of an action body. */
function firstToken(body: string): string {
  const m = /^[a-zA-Z]+/.exec(body);
  return m ? m[0] : '';
}

/**
 * Check Go template source for syntax errors. Returns one entry per problem;
 * an empty array means the template parses (to the depth this checker models).
 */
export function checkGoTemplateSyntax(
  src: string,
  opts: TemplateCheckOptions = {},
): TemplateSyntaxError[] {
  const errors: TemplateSyntaxError[] = [];
  const { actions, fatal } = lexActions(src);
  if (fatal) {
    errors.push(fatal);
    return errors;
  }

  // Track control-flow nesting.
  const stack: string[] = [];

  for (const action of actions) {
    if (action.isComment) continue;
    if (action.body === '') {
      errors.push({ message: 'empty action "{{}}"' });
      continue;
    }

    const tok = firstToken(action.body);
    if (KEYWORDS.has(tok)) {
      if (tok === 'end') {
        if (stack.length === 0) {
          errors.push({ message: 'unexpected "{{end}}" with no matching block' });
        } else {
          stack.pop();
        }
      } else if (tok === 'else') {
        const top = stack[stack.length - 1];
        if (top === undefined || !ELSE_CONTEXTS.has(top)) {
          errors.push({ message: 'unexpected "{{else}}" outside of if / range / with' });
        }
      } else if (BLOCK_OPENERS.has(tok)) {
        stack.push(tok);
      }
      // `template` takes no `end` — nothing to push.
      continue;
    }

    // Non-keyword leading token. Optionally check the function allow-list.
    if (opts.strictFunctions && opts.knownFunctions) {
      checkFunctions(action.body, opts.knownFunctions, errors);
    }
  }

  for (let s = stack.length - 1; s >= 0; s--) {
    errors.push({ message: `unclosed "{{${stack[s]}}}" action: missing "{{end}}"` });
  }

  return errors;
}

/**
 * Opt-in: flag bare identifiers in command position that are not known
 * functions. A bare leading word in a Go pipeline stage is a function call;
 * fields (`.x`), variables (`$x`), and literals are skipped. Conservative by
 * design — see PARITY.md for why this is off by default.
 */
function checkFunctions(
  body: string,
  known: ReadonlySet<string>,
  errors: TemplateSyntaxError[],
): void {
  // Split into pipeline stages on top-level `|` (ignore `|` inside strings).
  const stages = splitPipeline(body);
  for (const stage of stages) {
    const trimmed = stage.trim();
    if (trimmed === '') continue;
    const first = trimmed.split(/\s+/)[0] as string;
    // Skip fields, variables, parenthesised sub-pipelines, string/number
    // literals, assignment, and keywords.
    if (
      first.startsWith('.') ||
      first.startsWith('$') ||
      first.startsWith('(') ||
      first.startsWith('"') ||
      first.startsWith('`') ||
      first.startsWith("'") ||
      /^[-+]?[0-9]/.test(first) ||
      KEYWORDS.has(first) ||
      LITERALS.has(first)
    ) {
      continue;
    }
    const name = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(first)?.[0];
    if (name && !known.has(name)) {
      errors.push({
        message: `function "${name}" not defined`,
        isFunctionError: true,
      });
    }
  }
}

function splitPipeline(body: string): string[] {
  const stages: string[] = [];
  let current = '';
  let i = 0;
  while (i < body.length) {
    const c = body[i] as string;
    if (c === '"' || c === '`' || c === "'") {
      const end = scanString(body, i, c);
      if (end === -1) {
        current += body.slice(i);
        break;
      }
      current += body.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (c === '|') {
      stages.push(current);
      current = '';
      i += 1;
      continue;
    }
    current += c;
    i += 1;
  }
  stages.push(current);
  return stages;
}
