# Contributing

Thanks for helping improve the AIgentFlow flow validator.

Requires Node ≥ 20 (the test toolchain needs it; Node 18 is EOL).

## Development setup

```bash
npm install
npm run ci     # the full gate — MUST pass before you push
```

`npm run ci` runs exactly what GitHub Actions runs — `typecheck → lint →
format:check → test → build` — so a green local run means a green CI run. The
GitHub workflow invokes this same script (on Node 20 and 22), so the two cannot
diverge. **Run it before every push** (it is the pre-push step of the dev cycle).

Individual steps if you need them: `npm run typecheck`, `npm run lint`,
`npm run format` (auto-fix) / `npm run format:check`, `npm test`, `npm run build`.

## Project layout

```
src/
  index.ts                 # public API (validateFlow, validateFlowObject, parseFlow)
  cli.ts                   # CLI entry (the ONLY module allowed to use node: builtins)
  parse.ts                 # YAML → object (the `yaml` package)
  types.ts                 # public + flow types
  spec/aigentflow-spec.json # vendored enum surface (single source of truth)
  spec/index.ts            # typed accessor over the spec
  template/gotmpl-syntax.ts # Go text/template syntax checker
  validators/*.ts          # one module per validation concern
test/
  *.test.ts                # unit tests
  conformance/             # fixtures + structural verdict tests
```

## Ground rules

- **The library entry must stay browser-safe.** Do not import `node:*` (or `fs`, `path`,
  `process`, …) anywhere reachable from `src/index.ts`. The only place Node built-ins are
  allowed is `src/cli.ts`. The CI build and a grep guard enforce this.
- **One runtime dependency.** The core depends only on `yaml`. Adding another runtime
  dependency needs a strong justification.
- **Enums live in `spec/aigentflow-spec.json`.** Don't hard-code scheme/type/action lists
  in validator modules — read them from the spec accessor.
- **Validators are defensive.** User YAML is arbitrary; treat the document as `unknown`
  and narrow with the guards in `validators/util.ts`. Emit `invalid_type` rather than
  throwing.
- **`code` is a stable contract.** New issues get a new, descriptive `code`. Don't repurpose
  an existing code for a different meaning.

## Adding or changing a rule

This validator mirrors the AIgentFlow Go reference. Before changing validation behaviour,
read [PARITY.md](./PARITY.md) — especially the **Migration discipline** checklist — and:

1. Port the rule from the Go source into the right `validators/*.ts` module.
2. If it introduces a divergence from the reference, document it in PARITY.md.
3. Add a unit test and a conformance fixture (`test/conformance/`).
4. If the change involves a new enum value, update `spec/aigentflow-spec.json` and bump
   `specVersion`.

## Public-repo hygiene

This is an open-source repository. Never commit anything internal: no internal docs,
credentials, private endpoints, or internal organisation identifiers. Conformance fixtures
must be freshly authored and free of any such values.
