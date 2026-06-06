# Parity with the AIgentFlow reference validator

This document maps every rule in this JavaScript validator back to the AIgentFlow
Go reference implementation, records the intentional divergences, and defines the
discipline for keeping the two in sync.

**Tracks AIgentFlow flow schema: `v2.433.0`** (`SPEC_VERSION` in [`src/spec/aigentflow-spec.json`](./src/spec/aigentflow-spec.json)).

The Go reference has two layers, both ported here:

- `Validator.ValidateFlowWithDetails` — `aigentflow/aigentflow.validation.go` (the structured-result validator; our primary model).
- `FlowParser.ValidateFlow` — `aigentflow/aigentflow.parser.go` (parse-time structural checks).

Comparison contract: **error `code` + `valid` verdict**, not message wording. The conformance suite (`test/conformance/`) asserts verdicts structurally.

---

## Rule map

| Area                                                                          | Go source                                                                                         | JS module                                               | Tested by                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| Required fields, start-step existence, per-step executor, reserved `.` in IDs | `validateBasicStructure`, `ValidateFlow` head                                                     | `validators/basicStructure.ts`                          | `validate.test.ts`                          |
| Executor URI shape + scheme                                                   | (registry, runtime)                                                                               | `validators/executors.ts`                               | `validate.test.ts`                          |
| Query/property/array-item schema + array constraints                          | `validateQueryParameters`, `validateProperties`, `validateArrayItems`, `validateArrayConstraints` | `validators/querySchema.ts`                             | `validate.test.ts`                          |
| Response-expectation types + array items + `required`                         | `ValidateFlow` (response block), `validateSemantics`                                              | `validators/responseExpectation.ts`                     | `validate.test.ts`                          |
| Error strategy (action, goto, max_delay, backoff, retry_on)                   | `validateErrorStrategy`                                                                           | `validators/errorStrategy.ts`                           | `validate.test.ts`                          |
| `next` references, reachability, cycles                                       | `validateStepConnectivity`, `findReachableSteps`, `checkForCycles`                                | `validators/connectivity.ts`                            | `validate.test.ts`                          |
| `next.parallel` + orchestrator-next requirement                               | `validateNextLogic`, `validateOrchestratorNext`                                                   | `validators/nextLogic.ts`                               | `validate.test.ts`                          |
| Expression functions (XOR package/function)                                   | `validateExpressionFunctions`                                                                     | `validators/expressionFunctions.ts`                     | `validate.test.ts`                          |
| Loop / for_each / throttle                                                    | `validateLoop`, `validateForEach`, `validateThrottle`                                             | `validators/loopForEachThrottle.ts`                     | `validate.test.ts`                          |
| Orchestrator structure + campaign requires orchestrator                       | `validateOrchestrator`, `validateAndNormalizeCampaign`                                            | `validators/orchestratorCampaign.ts`                    | `validate.test.ts`                          |
| Credential bindings (`stored/...`, inject_as, exclusivity)                    | `validateStepCredentialBindings`                                                                  | `validators/credentialBindings.ts`                      | `validate.test.ts`                          |
| `input_schema` definition + ordering lint                                     | `ValidateInputSchemaDefinition`, `LintInputSchemaFieldOrdering`                                   | `validators/inputSchema.ts`                             | `validate.test.ts`                          |
| Go-template syntax                                                            | `validateTemplateExpression` (Parse step)                                                         | `template/gotmpl-syntax.ts` + `validators/templates.ts` | `gotmpl-syntax.test.ts`, `validate.test.ts` |

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
