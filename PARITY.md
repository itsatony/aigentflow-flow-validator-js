# Parity with the AIgentFlow reference validator

This document maps every rule in this JavaScript validator back to the AIgentFlow
Go reference implementation, records the intentional divergences, and defines the
discipline for keeping the two in sync.

**Tracks AIgentFlow flow schema: `v2.642.0`** (`SPEC_VERSION` in [`src/spec/aigentflow-spec.json`](./src/spec/aigentflow-spec.json)).

> v2.642.0 — **`expression_functions:` stopped being inert.** The block had always
> been validated for SHAPE (exactly one key, `package` XOR `function`, non-empty
> value) and honoured in no other way: nothing read it, so a flow could declare
> functions and get none. It is now a real opt-in over a **fixed catalog of 20
> functions compiled into the AIgentFlow binary**. Three rules ported, all into
> [`src/validators/expressionFunctions.ts`](./src/validators/expressionFunctions.ts);
> the pre-existing structural rules are unchanged and still fire first.
>
> 1. **`package:` is refused** (`expression_function_package_unsupported`).
>    Nothing is loaded at run time, ever — there is no safe way to load a package
>    at run time, and flow YAML is reachable by any authenticated caller, so the
>    catalog _is_ the security envelope. The message points at `function:` and
>    lists the catalog.
> 2. **A `function:` outside the catalog is refused** (`expression_function_unknown`).
>    The catalog is an enumerable, compile-time-linked set, which is why this is
>    an error and not the lag-prone allow-list warning of divergence #4 — a name
>    this validator does not know is a name AIgentFlow does not have.
> 3. **A template action calling an `fn_` name must name a catalog entry
>    (`expression_function_unknown_use`) and be declared by the flow
>    (`expression_function_undeclared_use`).** This is what makes the block
>    load-bearing rather than decorative. Only the text between `{{` and `}}` is
>    scanned, so a description mentioning `fn_slugify` in prose is not a call, and
>    the action pattern is newline-tolerant so a multi-line action in a block
>    scalar is matched whole. Every catalog name carries the `fn_` prefix
>    precisely so a catalog entry can never shadow a standard function such as
>    `index` or `default`.
>
> The 20 catalog names are also added to `templateFunctions`: the reference
> registers the whole catalog on its standard template registry unconditionally,
> so `{{ fn_round … }}` is a _known_ function there, and omitting them would make
> `{ strictRegistries: true }` report a second, wrong verdict on a correct flow.
>
> **Severity choice — the save door vs the run door.** Upstream, rules 1 and 2 are
> hard refusals when a flow is SAVED but only warnings when a stored flow is
> LOADED, so flows written before the rules existed keep running. This validator
> has no notion of doors and no severity meaning "refused at save, tolerated at
> run"; it answers **"would this save"**, which is the same choice already made
> for the executor-URL shape rule (also retroactive-tolerant upstream, also an
> error here). So all three rules are `error`, and no new severity was invented.
> **Consequence to know:** a flow this validator refuses may still be running in
> production — the refusal means it can no longer be saved unchanged, not that it
> is broken. Rule 3 is save-door-only upstream for a different reason (cost: the
> scan re-serialises the flow, and the load path runs on every mission start),
> which lands in the same place.
>
> **One deliberate scope difference (divergence #10).** The Go rule re-serialises
> the `Flow` struct, so it sees only fields that struct declares; this validator
> walks the parsed document, so it also sees keys the struct does not carry. On a
> flow AIgentFlow would accept the two are identical, because AIgentFlow's create
> path parses with `KnownFields(true)` and refuses anything else outright.
>
> **Correction to rule 3, made in the reference and ported here: a FIELD is not a
> CALL.** The first cut matched `\bfn_[A-Za-z0-9_]+`, and `\b` matches happily
> between the `.` and the `f` — so `{{ .data.fn_total }}`,
> `{{ .step.response.fn_score }}`, `{{ index .data "fn_result" }}` and
> `{{ index .data "step.fn_result" }}` were all read as calls. A flow with a state
> field, a step, or a data key whose name begins with `fn_` was then **refused
> with a message about a function it never called** — a false refusal on a valid
> flow, which is worse than a missed detection. Two guards, both required, each
> covered by its own test: quoted spans (`"…"` and backticks) are **stripped from
> the action before the scan**, because a quoted string inside an action names a
> data key rather than an identifier; and the character before `fn_` must be
> neither a dot nor a word character. The Go side captures and discards that
> character (`(^|[^.\w])(fn_…)`) because RE2 has no lookbehind; this validator uses
> the negative lookbehind `(?<![.\w])`, which is the cleaner equivalent — no
> capture group, and it cannot consume the delimiter between two adjacent matches
> — and is available on the Node >= 20 this package requires. A real call still
> matches after `{{`, `(`, `|` or whitespace.
>
> New conformance fixtures: `invalid-expression-function-package.yaml`,
> `invalid-expression-function-unknown-name.yaml`,
> `invalid-expression-function-undeclared-use.yaml`,
> `valid-expression-functions.yaml`,
> `valid-expression-function-prose-mention.yaml`,
> `valid-expression-function-field-lookalikes.yaml`.

> v2.640.0 — `unique_items` removed from the spec surface and from
> `PropertyDefinition`. AIgentFlow deleted the grammar field: it was declared
> twice in the Go domain with **zero** readers anywhere, and the served OpenAPI
> spec advertised it under a camelCase name the YAML parser would have rejected.
> Nothing honoured it in either direction. `billing.budget_exceeded_policy`,
> deleted in the same upstream cycle, was never mirrored here.

> v2.608.0 (AIF DC-FORGE-38 — a parity sweep covering v2.485.0 → v2.607.0).
> The audit of that 122-release window found only four rule-changing commits, and
> the sweep closed every one that is in scope, plus a defect in this validator
> that predates the window and mattered more than any of them.
>
> 1. **`next.conditions[].goto` — this validator read the wrong key.** The YAML
>    key is `goto`; `ConditionDefinition.GotoStep` carries `yaml:"goto"`
>    (aigentflow.domain.step.go:134). It is the ONE place in the grammar spelled
>    that way — the flow-level and step-level `error_strategy` and `quality_gate`
>    all use `goto_step` — and this validator read `goto_step` everywhere,
>    including here. Two silent consequences: a conditional branch naming a
>    step that does not exist was **never reported** (`step_not_found` on a
>    condition could not fire at all), and every conditionally-reached step was
>    accused of being `unreachable_step`. Measured against AIgentFlow's own
>    validator over its 203 bundled flows, this validator reported **100**
>    unreachable steps where the reference reported 24, and **missed** the one
>    `potential_infinite_loop` the reference finds. Both numbers now match
>    exactly. The old conformance fixtures used `goto_step`, so the whole suite
>    was green over the defect. A condition carrying `goto_step` is now an
>    explicit error (`unknown_yaml_key`), because AIgentFlow's create/update/
>    validate path parses with `KnownFields(true)` and refuses such a flow
>    outright — verified directly against the Go parser.
> 2. **Executor URL shape (AIF DC-FORGE-30, v2.598.0; DC-FORGE-38, v2.608.0).**
>    `FlowParser.ValidateFlow` now applies the ONE parser (`URL_PATTERN_REGEX`,
>    `ParseExecutorURLString`) to every step executor, and from v2.608.0 to
>    `loop.steps[i].executor` as well. `openai:///gpt-4`, `ai://openai` and
>    `http://api.example.com/v1` are refused at SAVE; this validator accepted all
>    three. The regex is vendored verbatim as `executorUrlPattern`. **Templated
>    URLs are skipped** in both implementations — the engine renders
>    `step.executor` as a Go template before dispatch, and omitting that exception
>    rejected eight working bundled flows when the Go rule was first written.
>    Divergence #1 is untouched: the new rule is about SHAPE, and an unknown
>    scheme is still a warning.
> 3. **Reachability follows five edge kinds (AIF DC-FORGE-30 §8, v2.598.0 +
>    v2.598.1).** `findReachableSteps` delegates to the simulator's
>    `collectNextTargets` — `next.default`, `next.conditions[].goto`,
>    `next.parallel.steps[]`, `next.parallel.rendezvous`, step-level
>    `error_strategy.goto_step` — plus the FLOW-level `error_strategy.goto_step`
>    seeded into the queue. **The cycle detector was deliberately NOT widened**
>    (`checkForCycles` still walks two edges), so this validator now uses two
>    separate target functions; widening `hasCycle` too would invent a divergence
>    and emit a spurious `potential_infinite_loop` on any rendezvous or error
>    redirect back to an earlier step.
> 4. **`executorSchemes` is AIgentFlow's registered set exactly** (43 protocols,
>    enumerated from `NewExecutorSchemaRegistry`). `web://` was missing, so a
>    correct step warned; nine schemes AIgentFlow does not register (`openai`,
>    `anthropic`, `perplexity`, `vertexai`, `ollama`, `vllm`, `aigentchat`,
>    `external`, `https` — legacy names banner-marked non-functional in AIF
>    v2.596.0) were listed, so this validator stayed silent where AIgentFlow
>    fails at dispatch.
>
> **Audited and deliberately NOT ported** (recorded so the next sweep does not
> re-derive them):
>
> - `ValidateExecutorConfigEnvScopes` (AIF DC-FORGE-29, v2.597.0) — `executor_config`
>   may only expand the environment variables belonging to the provider or protocol
>   it writes them under. The rule is a pure function of the flow and is therefore
>   portable, but faithful parity needs four vendored scope tables
>   (`authorEnvScopes`, `aiProviderEnvScopeExtras`, `nexusEnvScope`,
>   `executorConfigKeyProtocols`) — a new vendoring surface that will drift silently,
>   and a reduced-fidelity version produces false positives on the `extras` rows.
>   **Owed, not skipped.**
> - Unknown-key rejection. AIgentFlow's create path has always parsed with
>   `KnownFields(true)`; AIF v2.604.0 made `POST /flows/validate` and the Studio
>   assistant strict too, so "would this save" now answers the same everywhere.
>   This validator inspects no unknown keys, so a step-level `output:` block
>   (the real grammar is `post_processing: - output.set:`) still validates clean.
>   Porting it means a full field inventory of `Flow`/`StepDefinition` and
>   interacts with divergence #8. **A decision to make, not a delta.** The one
>   case that mattered in practice — `goto_step` inside a condition — is now
>   reported specifically.
> - Everything else in the window is runtime field resolution (divergence #3),
>   credentials/compliance (#5, #6) or documentation surface: AIF 2.526.0's
>   `DeploymentQueryOption` rename, 2.580.0/2.582.0/2.585.0's
>   `template_missing_field` grounding, 2.591.0–2.594.0's step-query stripping,
>   2.603.0's billed-header redaction, 2.604.0's `BuildOutputContractWarnings`.
>   `input_schema.go` and `template.registry.go` have a **zero** diff across the
>   whole window, and no new YAML-tagged flow or step field was added.

> v2.485.0 (DC-COND-2 CONDUCTOR): added the `campaign.on_children_complete`
> field (names the step the engine deterministically routes into once every
> spawned child is terminal). One static check ported:
> `campaign_handoff_step_unknown` (the referenced step must exist in `steps`) —
> consistent with the existing `next`-reference validation. The field's _runtime_
> effect (the deterministic all-children-terminal hand-off, idle-tick gating,
> event-authoritative campaign state) is engine behaviour and out of scope for
> static validation. New conformance fixtures: `valid-campaign-handoff.yaml`,
> `invalid-campaign-handoff-unknown-step.yaml`.
>
> v2.484.0 (DC-COND-1 CONDUCTOR): added the orchestrator `mode:` field
> (`monitor` | `owner`, default `monitor`). Two static checks ported:
> `orchestrator_mode_invalid` (unknown mode value) and
> `orchestrator_owner_needs_yield` (`owner` mode requires at least one step with
> `next: orchestrator` — mirrored via `flowHasOrchestratorYieldEdge`). The
> mode's _runtime_ effect (terminal-vs-yield lifecycle, deterministic backstops)
> is engine behaviour and out of scope for static validation. New conformance
> fixtures: `valid-orchestrator-monitor.yaml`, `invalid-orchestrator-owner-no-yield.yaml`.
>
> v2.478.0: added the `htmlDocument` template function (sanitises LLM chat output
> destined for public hosting — slices `<!doctype>`…`</html>`, dropping markdown
> fences + conversational preamble/postamble). Allow-list only; runtime behaviour
> is out of scope for static validation.

The Go reference has two layers, both ported here:

- `Validator.ValidateFlowWithDetails` — `aigentflow/aigentflow.validation.go` (the structured-result validator; our primary model).
- `FlowParser.ValidateFlow` — `aigentflow/aigentflow.parser.go` (parse-time structural checks).

Comparison contract: **error `code` + `valid` verdict**, not message wording. The conformance suite (`test/conformance/`) asserts verdicts structurally.

---

## Rule map

| Area                                                                          | Go source                                                                                         | JS module                                                | Tested by                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------- |
| Required fields, start-step existence, per-step executor, reserved `.` in IDs | `validateBasicStructure`, `ValidateFlow` head                                                     | `validators/basicStructure.ts`                           | `validate.test.ts`                          |
| Executor URI shape (the ONE parser) + scheme                                  | `ValidateFlow` executor-URL rule (parser.go), `ParseExecutorURLString`                            | `validators/executors.ts`                                | `validate.test.ts`                          |
| Query/property/array-item schema + array constraints                          | `validateQueryParameters`, `validateProperties`, `validateArrayItems`, `validateArrayConstraints` | `validators/querySchema.ts`                              | `validate.test.ts`                          |
| Response-expectation types + array items + `required`                         | `ValidateFlow` (response block), `validateSemantics`                                              | `validators/responseExpectation.ts`                      | `validate.test.ts`                          |
| Error strategy (action, goto, max_delay, backoff, retry_on)                   | `validateErrorStrategy`                                                                           | `validators/errorStrategy.ts`                            | `validate.test.ts`                          |
| `next` references, reachability, cycles                                       | `validateStepConnectivity`, `findReachableSteps`, `checkForCycles`                                | `validators/connectivity.ts`                             | `validate.test.ts`                          |
| `next.parallel` + orchestrator-next requirement                               | `validateNextLogic`, `validateOrchestratorNext`                                                   | `validators/nextLogic.ts`                                | `validate.test.ts`                          |
| Expression functions (XOR package/function)                                   | `validateExpressionFunctions`                                                                     | `validators/expressionFunctions.ts`                      | `validate.test.ts`                          |
| Expression-function catalog (`package:` refused, unknown `function:` refused) | `validateExpressionFunctionCatalog` (parser.go)                                                   | `validators/expressionFunctions.ts`                      | `validate.test.ts`, `conformance.test.ts`   |
| Expression-function USE (`{{ fn_* }}` must be in the catalog AND declared)    | `validateExpressionFunctionUsage` (parser.go)                                                     | `validators/expressionFunctions.ts`                      | `validate.test.ts`, `conformance.test.ts`   |
| Loop / for_each / throttle                                                    | `validateLoop`, `validateForEach`, `validateThrottle`                                             | `validators/loopForEachThrottle.ts`                      | `validate.test.ts`                          |
| Orchestrator structure + campaign requires orchestrator                       | `validateOrchestrator`, `validateAndNormalizeCampaign`                                            | `validators/orchestratorCampaign.ts`                     | `validate.test.ts`                          |
| Credential bindings (`stored/...`, inject_as, exclusivity)                    | `validateStepCredentialBindings`                                                                  | `validators/credentialBindings.ts`                       | `validate.test.ts`                          |
| `input_schema` definition + ordering lint                                     | `ValidateInputSchemaDefinition`, `LintInputSchemaFieldOrdering`                                   | `validators/inputSchema.ts`                              | `validate.test.ts`                          |
| Step `output_schema` definition (reuses the input-schema subset)              | `ValidateInputSchemaDefinition` (on `step.OutputSchema`, parser.go)                               | `validators/outputSchema.ts` (+ shared `inputSchema.ts`) | `validate.test.ts`                          |
| `quality_gate:` block (rubric/threshold/on_fail/goto)                         | `FlowParser.validateQualityGate` (parser.go)                                                      | `validators/qualityGate.ts`                              | `validate.test.ts`                          |
| Go-template syntax                                                            | `validateTemplateExpression` (Parse step)                                                         | `template/gotmpl-syntax.ts` + `validators/templates.ts`  | `gotmpl-syntax.test.ts`, `validate.test.ts` |

---

## Intentional divergences

These are deliberate, documented differences from the Go static pass. They keep the
validator useful and low-false-positive while staying offline.

1. **Executor scheme is a warning, not an error.** The Go static validator does not
   reject unknown schemes (the live executor registry decides at runtime, and schemes
   are added frequently). We flag a **malformed** URI (`invalid_executor_url`) as an
   error — that is always genuinely broken — but an unrecognised scheme is a
   `unknown_executor_scheme` **warning**. This means a brand-new AIgentFlow scheme never
   produces a false failure here.

2. **`end` is always a terminal marker.** The reference is internally inconsistent —
   `validateStepConnectivity` exempts `end`, while `validateNextLogic` does not. We follow
   the structured validator (and the reachability/cycle code) and treat `null`, `end`,
   and `orchestrator` as terminal everywhere.

3. **Runtime template field-resolution is not reproduced.** Go additionally _executes_
   each template against a mock context to emit `template_missing_field` /
   `condition_not_boolean` **warnings**. That requires simulating the runtime state graph;
   we validate template **syntax** only. (Candidate for a future best-effort pass.)

4. **Unknown orchestrator tools / template functions are warnings by default.** The
   vendored allow-lists (`orchestrator.tools`, `templateFunctions`) can lag the live
   AIgentFlow registries. Pass `{ strictRegistries: true }` to make them errors.

5. **Orchestrator exons spec body is not parsed.** Go parses the `orchestrator.exons`
   spec through the go-exons engine and extracts the provider. That engine is not ported;
   we require the spec to be **present** but do not parse its contents.

6. **Compliance / credentials / publish gates are out of scope** — they require a live
   server, the provider catalogue, and org context. See the README.

7. **Regex engine.** `input_schema` `pattern` compilation uses the JS regex engine, not
   Go RE2. A pattern valid in one engine but not the other is a (rare) known divergence.

8. **Shape errors.** Because YAML decodes into an untyped object (vs. Go's typed
   unmarshal), this validator emits `invalid_type` errors where Go would have failed at
   decode time. This is strictly additive.

9. **`unresolvable_data_path` is not reproduced (DC-CP-7).** The Go engine, when a step
   declares an `output_schema`, treats that step's output as a typed contract and errors
   (`unresolvable_data_path`) on any `.data.<step>.<field>` template reference elsewhere in
   the flow that names a field the producing step's `output_schema` does not declare
   (opt-in: steps _without_ an `output_schema` are left lenient). Emitting it here would
   require statically resolving `.data.<step>.<field>` references out of every template and
   matching them to the producing step — i.e. the very runtime template field-resolution
   this validator deliberately does not perform (see divergence #3). We therefore validate
   the `output_schema` **definition** (structure/field types, via the shared input-schema
   validator) but do **not** cross-check template references against it. Candidate for the
   same future best-effort resolution pass as divergence #3.

   The `wait://` and `eval://` schemes (DC-CP-5 / DC-CP-8) are now in the known-scheme set,
   so they no longer warn (`unknown_executor_scheme`); malformed `wait://` / `eval://` URIs
   still error via the shared shape check. `quality_gate.on_fail=human` exists in the Go
   enum but is validation-REJECTED there (pending the human-task inbox), so this validator
   rejects it too (`quality_gate_on_fail_unsupported`) — this is parity, not a divergence.

10. **The `fn_*` usage scan walks the document, not the typed struct (v2.642.0).** The
    Go rule re-serialises the `Flow` struct before scanning for template actions, so it
    sees only fields the struct declares. This validator has no typed unmarshal, so it
    walks every string leaf of the parsed document — including keys the Go struct does
    not carry. The two agree on every flow AIgentFlow would accept, because its create
    path parses with `KnownFields(true)`; they differ only on a document that AIgentFlow
    rejects for an unrelated reason. Same family as divergence #8, and strictly additive.

    Severity: the catalog and usage rules are refused at AIgentFlow's SAVE door and only
    warned at its load/run door, so a flow stored before the rules existed keeps running.
    This validator answers "would this save" and therefore reports all of them as
    `error` — the choice already made for the executor-URL shape rule. That is parity
    with the save door, not a divergence, but it means a refusal here does **not** imply
    a broken running flow.

---

## Migration discipline — keep this in sync with AIgentFlow

When the AIgentFlow flow grammar or validation rules change, this validator **must** be
updated. The trigger conditions and the checklist:

**Triggers** (any flow-YAML-affecting change in the `aigentflow` repo):

- a new executor scheme;
- a new top-level flow field or step field;
- a new/changed enum (data types, error actions, next markers, resolutions, input-schema
  field types, orchestrator triggers/tools);
- a new or changed validation rule in `aigentflow.validation.go`, `aigentflow.parser.go`,
  or `aigentflow.input_schema.go`;
- a new template function in `aigentflow.template.registry.go`.

**Checklist:**

1. Update [`src/spec/aigentflow-spec.json`](./src/spec/aigentflow-spec.json) — the enum
   values and bump `specVersion` to the new AIgentFlow version.
2. Port the rule into the matching `validators/*.ts` module (or add a new module).
3. Add a row to the [rule map](#rule-map) above and, if it diverges, an entry under
   [Intentional divergences](#intentional-divergences).
4. Add a conformance fixture under `test/conformance/fixtures/` plus an entry in
   `test/conformance/conformance.test.ts`, and a focused unit test.
5. `npm run typecheck && npm run lint && npm test && npm run build` — all green.
6. Bump the package version and update `SPEC_VERSION` in the README.

> The `aigentflow` repository's `CLAUDE.md` carries a reciprocal note pointing back here,
> so a flow-YAML change in either repo surfaces the obligation to update the other.
