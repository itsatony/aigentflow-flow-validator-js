# aigentflow-flow-validator

Static, offline validator for [AIgentFlow](https://aigentflow.dev.ai.vaud.one) workflow YAML — for **Node**, the **browser**, and the **command line**.

It catches the structural and semantic problems in a flow definition _before_ you upload it to a server: missing required fields, dangling step references, malformed executor URIs, broken Go-template syntax, invalid `input_schema` fields, unbalanced query/response schemas, and more. It is a faithful port of the **static** checks performed by the AIgentFlow Go engine, so a flow that passes here passes the server's structural validation.

- **Zero-config, offline, deterministic.** No network, no credentials, no server.
- **Tiny + portable.** One runtime dependency (`yaml`); the library entry uses no Node built-ins, so it runs in browsers and bundlers unchanged.
- **Typed.** Ships TypeScript declarations and a stable, machine-readable result shape.
- **Parity-tracked.** Mirrors a pinned AIgentFlow flow-schema version — see [PARITY.md](./PARITY.md).

> **Scope:** this validator does **static** checks only. It does **not** check credentials, the model-compliance catalogue, or runtime template field-resolution — those require a live server and are out of scope. See [What it does not check](#what-it-does-not-check).

---

## Install

```bash
npm install @vaudience/aigentflow-flow-validator
```

You can also install straight from git (the `prepare` script builds `dist/`
automatically on install):

```bash
npm install github:itsatony/aigentflow-flow-validator-js
```

Requires Node ≥ 20 (for library + CLI use). For browser/bundler use, any modern bundler works.

---

## Usage

### Node (ESM)

```ts
import { validateFlow } from '@vaudience/aigentflow-flow-validator';

const result = validateFlow(yamlString);
if (!result.valid) {
  for (const e of result.errors) {
    console.error(`${e.code} [${e.field}]: ${e.message}`);
  }
}
```

### Node (CommonJS)

```js
const { validateFlow } = require('@vaudience/aigentflow-flow-validator');
const result = validateFlow(yamlString);
```

### Browser / bundler

The package's main entry pulls in no Node built-ins, so it works in the browser via any bundler (Vite, webpack, esbuild, Rollup):

```ts
import { validateFlow } from '@vaudience/aigentflow-flow-validator';

const result = validateFlow(editor.getValue());
renderDiagnostics(result.errors, result.warnings);
```

### Already have a parsed object?

If you parsed the YAML yourself (or are validating JSON), skip the parse step:

```ts
import { validateFlowObject } from '@vaudience/aigentflow-flow-validator';
const result = validateFlowObject(myFlowObject);
```

### CLI

```bash
# Validate one or more files
npx aigentflow-validate flow.yaml
npx aigentflow-validate flows/*.yaml

# Read from stdin
cat flow.yaml | npx aigentflow-validate -

# Machine-readable output
npx aigentflow-validate --json flow.yaml

# Treat warnings as failures (for CI gating)
npx aigentflow-validate --strict flow.yaml
```

Exit codes: **0** = valid, **1** = validation failed, **2** = usage error. Add it to CI to fail a build on a broken flow.

```
✓ flow.yaml: valid — 0 error(s), 1 warning(s), 4 step(s)
  warn unreachable_step [steps.cleanup]
      Step 'cleanup' is not reachable from start step
      ↳ Add a path to this step or remove it if not needed
```

---

## API

### `validateFlow(yaml: string, options?): ValidationResult`

Parse flow YAML and validate it. Parse failures (syntax errors, duplicate keys) are reported as `error`-severity issues with line/column when available.

### `validateFlowObject(flow: unknown, options?): ValidationResult`

Validate an already-parsed flow object.

### `parseFlow(yaml: string): ParseOutput`

Low-level: parse YAML into `{ flow?, parseErrors, parseWarnings }` without validating.

### `SPEC_VERSION: string`

The AIgentFlow flow-schema version this build tracks (e.g. `"2.433.0"`).

### Options

| Option             | Default | Effect                                                                                                                                                                                                                                                       |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `strictRegistries` | `false` | Report unknown orchestrator tool names and unknown template functions as **errors** instead of **warnings**. Off by default because the vendored allow-lists can lag the live AIgentFlow registries, and a false-positive error is worse than a missed lint. |

### Result shape

```ts
interface ValidationResult {
  valid: boolean; // true when there are zero error-severity issues
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  summary: {
    totalSteps: number;
    validSteps: number;
    errorCount: number;
    warningCount: number;
    templatesFound: number;
    templatesValid: number;
  };
}

interface ValidationIssue {
  field: string; // dotted path, e.g. "steps.fetch.query.url"
  message: string; // human-readable description
  code: string; // stable machine code, e.g. "step_not_found"
  severity: 'error' | 'warning' | 'info';
  stepId?: string;
  line?: number;
  column?: number;
  context?: string;
  suggestion?: string;
}
```

`code` is the stable contract — branch on it programmatically. `message` wording may change between releases.

---

## What it checks

- **Required fields** — `aigentflow_version`, `name`, `start`, at least one step.
- **Steps** — `start` resolves to a real step; every non-loop step has an `executor`; loop steps don't; reserved `.` in step IDs is rejected.
- **Executors** — `scheme://path` shape (error on malformed); unknown scheme (warning).
- **Query schema** — parameter types, `array` requires `items`, item-type validity, `min_items`/`max_items`, nested `object`/`array` recursion.
- **Response expectations** — valid data types; `array` requires `items`; `required` is boolean or template.
- **Error strategy** — action enum (`retry`/`fail`/`goto`/`continue`), `goto_step` existence, `max_delay` duration, `backoff_multiplier`, `retry_on` categories.
- **Connectivity** — `next.default` / `next.conditions[].goto_step` references (error); unreachable steps (warning); cycles (warning).
- **Parallel + orchestrator routing** — `next.parallel` rendezvous/steps; `orchestrator` next requires an orchestrator block.
- **Loop / for_each / throttle** — required fields, iteration limits, mutual exclusions, throttle ceilings.
- **Orchestrator / campaign** — exons presence, trigger types, timer intervals, tool names; campaign requires an orchestrator.
- **Credential bindings** — `stored/{provider}/{name}` format, `inject_as`, `credential`/`credentials` mutual exclusion.
- **Expression functions** — exactly one of `package`/`function`.
- **`input_schema`** — version, field-name pattern, type enum, per-type constraints, `pattern` compilation, `visible_when` predicate + reference resolution, duplicate-name detection, file-ordering lint.
- **Templates** — Go `text/template` **syntax** across query, processing, and conditions.

## What it does **not** check

These need a live server / org context and are intentionally out of scope:

- **Credentials** — whether a bound credential actually exists or is authorised.
- **Model compliance** — the `compliance:` block is enforced against the provider catalogue at flow-create time on the server.
- **Template field resolution** — whether `.data.x.y` will actually be populated at runtime (we validate syntax, not data flow).
- **Publish gates** — `visibility`/`classification`/template-metadata publish rules are server- and org-context dependent.

A clean result here means the flow is **structurally** sound — not that it will execute successfully against your specific credentials and data.

---

## Versioning & parity

This validator tracks a specific AIgentFlow flow-schema version, exposed as `SPEC_VERSION`. The enum surface (executor schemes, data types, error actions, input-schema field types, template functions, …) lives in [`src/spec/aigentflow-spec.json`](./src/spec/aigentflow-spec.json) and the rule-by-rule mapping to the Go reference is documented in [PARITY.md](./PARITY.md). When AIgentFlow's flow grammar changes, the validator is updated and the spec version bumped.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). In short: `npm install`, then `npm run typecheck && npm run lint && npm test && npm run build`.

## License

[MIT](./LICENSE) © vAudience.AI
