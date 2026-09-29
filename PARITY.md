# Parity with the AIgentFlow reference validator

This document maps every rule in this JavaScript validator back to the AIgentFlow
Go reference implementation, records the intentional divergences, and defines the
discipline for keeping the two in sync.

**Tracks AIgentFlow flow schema: `v2.788.0`** (`SPEC_VERSION` in [`src/spec/aigentflow-spec.json`](./src/spec/aigentflow-spec.json)), plus `server_owned_query_key` (package 0.15.1, below) from the AIgentFlow release after v2.790.0, and `credential_endpoint_unpaired` (package 0.15.2, below) from AIgentFlow v2.793.0 and the release after it.

> package 0.15.2 — **an endpoint a server-supplied credential will never be sent to**, in
> step with the Go port (go-aigentflow-validator v0.6.2). The spec (new section
> `credentialEndpointPairing`; `specVersion` unchanged) and the ten new conformance
> fixtures are the Go port's byte for byte.
>
> | Rule (reference)                                                                                             | Code                           | Severity | Module                                                                                      |
> | ------------------------------------------------------------------------------------------------------------ | ------------------------------ | -------- | ------------------------------------------------------------------------------------------- |
> | `validateCredentialEndpointPairing` (DC-FORGE-231), `validateFamilyCredentialEndpointPairing` (DC-FORGE-233) | `credential_endpoint_unpaired` | warning  | `validators/credentialEndpoint.ts`, `validators/goUrl.ts`, spec `credentialEndpointPairing` |
>
> - **Why.** AIgentFlow sends a credential the SERVER supplied (an org's or the
>   platform's stored key, or a value of one of the deployment's environment variables)
>   only to the endpoint that came with it: the default, the stored credential's own
>   base URL, or a deployment-configured one. An endpoint the flow names is honoured only
>   with a credential the flow supplies. The run-time refusal is the control; this
>   warning names, at save, the shapes statically certain to meet it.
> - **ai://.** A step's (or loop sub-step's) `<provider>_base_url` with no key of the
>   flow's own (the query's `api_key` / `<provider>_api_key`, or a literal
>   `executor_config.<provider>.api_key`), and a literal
>   `executor_config.<provider>.base_url` for an AI provider with no literal key beside
>   it, unless at least one step uses the provider and every such step brings its own
>   key. `ollama` and `vllm` are exempt.
> - **The executor families.** The reference's per-protocol table is spec data
>   (`credentialEndpointPairing.families`), each row's server-variable set evaluated. A
>   step warns when its secret (query first, then the family's `executor_config` block)
>   is exactly `${NAME}` for one of the row's server variables on a row whose plugin
>   expands references, and its endpoint (same order) is a literal: not templated, not a
>   reference, and not of the same origin as the row's default. Implicit-credential
>   families are not judged; `nexus://` and `aigentchat://` get the ai:// shape.
> - **The default-origin comparison needs Go's URL semantics**, so `validators/goUrl.ts`
>   ports `net/url.Parse` (what it refuses, and the scheme and host it extracts),
>   `strings.TrimSpace` (Go trims U+0085 and keeps U+FEFF) and `strings.ToLower` (simple
>   case mapping: U+0130 is `i`). Its outputs are pinned against the Go port's.
> - **Measured** with the built CLI against the reference's own verdict on 465 files (the
>   403-file differential corpus of the Go port, plus 62 boundary probes): identical
>   `(code, field)` pairs on the whole corpus (15 warnings, none on a bundled flow), and on
>   every probe but four — two shared with the Go port (divergence 18) and two JS-only
>   (below). Go `make parity-check` reports no drift.

> package 0.15.1 — **a step query may not declare a server-owned parameter**, in step
> with the Go port (go-aigentflow-validator v0.6.1). The spec (new section
> `serverOwnedQueryKeys`; `specVersion` unchanged) and the seven new conformance
> fixtures are the Go port's byte for byte.
>
> | Rule (reference)                                                        | Code                     | Severity | Module                                                            |
> | ----------------------------------------------------------------------- | ------------------------ | -------- | ----------------------------------------------------------------- |
> | `validateNoServerOwnedStepQueryKeys` / `IsServerOwnedParamKey` (CFX-05) | `server_owned_query_key` | error    | `validators/serverOwnedQueryKeys.ts`, spec `serverOwnedQueryKeys` |
>
> - **Why.** The `aiv://` executor sends the running org's aigentverse credential, or
>   a signed token naming the running person, to the base URL in its parameters, and
>   the reference used to lay a step's `query:` over the credential resolver's output.
>   A shared flow declaring `aiv_base_url: https://attacker.example` therefore chose
>   where that credential went. The reference now discards such a value at run time
>   and refuses it by name at save.
> - **Exactly as the reference.** The key set is data (`serverOwnedQueryKeys.keys`:
>   `aiv_api_key`, `aiv_base_url`, `aiv_delegation`), so a new server-owned key is a
>   spec change. Matching is exact and case-sensitive. The scanned surfaces are exactly
>   the reference's two: a top-level step's `query:` (field `steps.<step>.query.<key>`)
>   and a loop sub-step's `query:` (field `steps.<step>.loop.steps.<sub-step id>.query.<key>`,
>   `stepId` the loop step). A parallel branch or a `for_each` body is a top-level step.
>   Any value is refused, `null` and templates included; a key nested inside a query
>   value, the name as a value, and a flow input parameter of that name are not.
> - **Measured** (in the Go port, with the reference at the rule's commit, over the 216
>   bundled flows and every conformance fixture): identical `(code, field)` pairs, and
>   no bundled flow trips the rule. Go `make parity-check` reports no drift. Three
>   mutants here (the loop surface unscanned, the step surface unscanned, a folded
>   case): all killed.

> v2.788.0, package 0.15.0 — **every save-door rule AIgentFlow added after v2.753.0,
> in step with the Go port (go-aigentflow-validator v0.6.0).** Since AIgentFlow
> v2.788.0 its save door and `/flows/validate` are one verdict, so "refuses what
> AIgentFlow's save refuses" is one target. The spec is the Go port's
> `spec/aigentflow-spec.json` byte for byte (`specVersion` 2.788.0; new sections
> `orchestratorToolAllow`, `exons`, `executorConfigEnvScopes`), and so are the 19
> new conformance fixtures and the one changed one.
>
> | Rule (reference)                                                                | Code                                                                           | Severity               | Module                                              |
> | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------- | --------------------------------------------------- |
> | `end` is an ordinary step id to the reachability and cycle walks too (v2.760.0) | `unreachable_step` / `potential_infinite_loop` stop treating `end` as terminal | warning                | spec `reachabilityTerminalMarkers`                  |
> | `ValidateExecutorConfigEnvScopes` (v2.597.0)                                    | `executor_config_env_scope`                                                    | error                  | `validators/executorConfigEnv.ts`                   |
> | orchestrator `.exons` parse and spec presence (`validateOrchestrator`)          | `orchestrator_exons_parse_failed`                                              | error                  | `validators/exons.ts`                               |
> | orchestrator `.exons` `execution.provider`                                      | `orchestrator_exons_no_provider`                                               | error                  | `validators/exons.ts`                               |
> | orchestrator `requirements.resources` (v2.767.0)                                | `exons_resources_unhonoured`                                                   | error                  | `validators/exons.ts`                               |
> | a tool `orchestrator.tools` / `tools.allow` withholds (v2.760.0)                | `orchestrator_tool_withheld`                                                   | warning                | `validators/exons.ts`, spec `orchestratorToolAllow` |
> | inline `.exons` intake, on a step and on the orchestrator (v2.777.0)            | `exons_attributes`                                                             | error, **engine only** | not ported (divergence #16)                         |
>
> - **`executor_config_env_scope`.** `api_key`, `base_url` and `organization` are Go
>   `string` fields and are read by source text; an `extra` value is checked only when
>   it is a YAML string. A reference is exactly `${NAME}` with a non-empty name, so
>   `${A}${B}` is the single name `A}${B`. The scope table is the reference's own
>   function evaluated for every key that has one (38 keys); any other key refuses every
>   reference, and is looked up as an own property, so `constructor:` is an ordinary key.
> - **The frontmatter reader** follows the engine's extraction: an optional BOM, then
>   spaces or tabs, then `---` and LF or CRLF; the frontmatter closes at the next line
>   starting `---` followed by a line break or the end of the input, and is trimmed with
>   Go's `TrimSpace` (which trims U+0085 and not U+FEFF). The retired `{~exons.config~}`
>   block and an unclosed frontmatter are parse failures; no frontmatter, or an empty
>   one, is `orchestrator_exons_parse_failed` too, because the reference refuses an
>   orchestrator document without a spec. A frontmatter containing `{~` is not read at
>   all (the engine executes it before decoding). The three fields are decoded as
>   yaml.v3 decodes them non-strictly: an undeclared key is ignored, a declared one of
>   the wrong shape fails the decode (and the reader then judges nothing), a number is
>   its text, and a null list element is dropped.
> - **`orchestrator_tool_withheld`** is a warning, never an error: an unattended
>   orchestrator is a legitimate design. `enable_signals` defaults to on (a YAML boolean
>   only sets it), and a null `campaign:` is no campaign.
> - **Codes.** The reference refuses all of these at its strict parse with one generic
>   code; each code here is the reference's own name for the rule where it has one, as
>   in the Go port. The reference stops at the first refusal; this validator reports
>   each. The verdict is the same.
>
> **Measured.** The Go port's `make parity-check` reports no drift: the spec and all 94
> fixtures are byte-identical, and the verdict and error codes agree on every fixture.
> Over the 235 flow files in AIgentFlow's repository the verdict, error codes and
> warning codes agree with the Go port's built-in reader on 235 of 235. A 39-shape
> orchestrator frontmatter matrix (the Go port's 15-shape engine-agreement matrix plus
> 24 decode shapes, each verdict measured on the Go port) is pinned in
> `test/v0150-save-door.test.ts`; 32 of the 39 get the engine's own verdict, and the
> other 7 are divergence #16, all looser. 16 mutants of the new rules (each guard
> removed or inverted, the scope table emptied, the signal exemption dropped, the
> templated-frontmatter skip removed, the `end` marker restored): all killed.

> v2.753.0, package 0.14.1 — **a number where the reference expects text is that
> text, in every Go `string` field.** No grammar change, so `specVersion` stays
> `2.753.0`. The reference decodes a step reference, an enum, a name and a
> duration into a Go `string`, and yaml.v3 fills a `string` from any scalar by
> its **source text**: `next: { default: 2 }` names the step `"2"`, `action: 1`
> is the invalid action `"1"`, `name: 123` is the name `"123"`. This validator
> read most of those fields with `isString`, so a number was either
> **invisible** (an existence or enum check skipped: looser) or **absent** (a
> present value reported missing: stricter). Ported from the Go port's v0.5.1,
> whose verdicts were measured on the reference's strict save parser.
>
> | Shape                                                                                                                                    | Reference                      | 0.14.0                                                                | 0.14.1                                           |
> | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------ |
> | `next.default: 2`, a condition's `goto: 7`, `rendezvous: 9`, `error_strategy.goto_step: 9`, no such step                                 | refused, step not found        | valid (default, goto); `missing_required_field` / `goto_step_missing` | `step_not_found`                                 |
> | the same with the step present, and `parallel.steps: [1]`                                                                                | saves, reachable               | `unreachable_step`; `step_not_found` / `goto_step_missing`            | valid, reachable                                 |
> | `default: 1e3` with a step `1000`                                                                                                        | refused (`1e3` is not `1000`)  | valid                                                                 | `step_not_found`                                 |
> | step keys `1e3:`, `0x1F:`, `True:` named by the same spelling                                                                            | saves                          | `unreachable_step` (keys read `1000`, `31`, `true`)                   | valid                                            |
> | `action: 1`, `on_fail: 1`, `for_each.resolution: 1`, `orchestrator.mode: 1`                                                              | refused, invalid value         | valid                                                                 | the rule's own code                              |
> | `name: 123`, `aigentflow_version: 2.0`, `start: 1`, `rubric: 5`, `for_each.items: 5`, `inject_as: 5`, a `query` param/property `type: 1` | saves                          | `missing_required_field` / the rule's "missing" code                  | valid (`unknown_data_type` warning for the type) |
> | loop sub-steps `id: 3` / `id: 4`, `next: { default: 4 }`                                                                                 | saves                          | `loop_step_id_required`, `invalid_type`                               | valid                                            |
> | `executor: 42`                                                                                                                           | refused, unusable executor URL | `invalid_type`                                                        | `invalid_executor_url`                           |
> | `expression_functions: [{ function: 5 }]`                                                                                                | refused, not in the catalog    | `invalid_expression_function`                                         | `expression_function_unknown`                    |
>
> - **One reader.** Every Go `string` field is read through `Issues.stringAt` /
>   `stringOf` / `nonEmptyStringOf` (`validators/util.ts`), which return a string
>   as itself and a number or boolean by its source spelling. Only a mapping, a
>   list or null is "not a string". The `Issues` collector now carries the
>   pass's `scalarSources`, so the per-validator `sources` parameters are gone.
>   Sites are left alone where the value is compared only against a literal no
>   scalar spelling can equal (`orchestrator`, an `fn_` name, `{{`, an empty
>   `output:` entry), and a step `query:` is a Go `any` in the reference, not a
>   string field.
> - **The text comes from the parsed node, not the JS value.** The `yaml`
>   package resolves `1.0` to 1, `0x1F` to 31, `True` to true and `-0` to -0
>   before `toJS`. `parseFlow` reads `Scalar.source`, the scalar's own text,
>   from the document node for each value (as `scalarSources` did for
>   durations) and now for each **key** too: `retagScalarKeys` replaces a number
>   or boolean key's value with its source text before conversion, so `1e3:` is
>   the step `"1e3"`. Duplicate keys are compared by text, as yaml.v3 compares
>   them: `1:` and `1.0:` are two steps, `"1":` and `1:` are one.
>   `test/scalar-text.test.ts` pins the same 15 spellings the Go port pins
>   against yaml.v3 (`2`, `-0`, `+1`, `017`, `0o17`, `0x1F`, `1_000`, `1e3`,
>   `.5`, `0.10`, `.inf`, `true`, `True`, `FALSE`, `2024-01-01`) as a step key
>   and as a value.
> - **Timestamps need nothing here.** The `yaml` package's default YAML 1.2
>   core schema has no timestamp type, so `2024-01-01` is already the string
>   `"2024-01-01"`, which is what the reference's `string` field receives.
>   `1_000` and `017` differ between the two parsers as numbers, but both
>   parsers keep the text, which is all a `string` field reads.
> - **Measured.** The Go port's ten `*-numeric-*` conformance fixtures are
>   copied byte-for-byte, and `valid-open-key-sets.yaml` now forbids
>   `unreachable_step`. On 0.14.0, 10 of those 11 cases fail; on 0.14.1 all 75
>   fixtures pass, and the Go port's `make parity-check` (spec byte-identical,
>   fixture set identical, 75 verdicts equal) is green. Over the reference's
>   216 bundled flows, not one finding changed, with or without
>   `strictRegistries` (`unreachable_step` 25, `potential_infinite_loop` 1).

> v2.753.0 — **the three gaps that were looser than the reference in both ports
> are closed (package 0.14.0).** The reference's parser, validator, flow, step,
> orchestrator, campaign, input-schema and template-registry sources have a
> **zero** diff from `v2.738.0` to `v2.753.0`, so `specVersion` moves to
> `2.753.0` with no other rule change. Every verdict below was measured on the
> reference's save door (`NewStrictFlowParser().ParseFromYAMLBytes`, then
> `ValidateFlowWithDetails`) over a 133-shape probe matrix. Both ports now match
> the reference on all 133, and on all 65 conformance fixtures.
>
> 1. **`end` is not a sentinel at the save door.** `validateNextLogic` accepts
>    only `null` and `orchestrator` without a step of that name, so
>    `next: { default: end }` and a condition's `goto: end` are refused
>    ("step_id (end) … not found") unless a step is called `end`. `End`, a
>    rendezvous `end`, a parallel member `end`, an `error_strategy.goto_step: end`
>    and a `quality_gate.goto_step: end` were already refused on both sides.
>    `next: end` (a scalar) fails to decode. **Divergence #2 is closed**, and it
>    was hiding a real problem: 15 fixtures this suite called valid routed to
>    `end`, and the reference refused all 15 (14 on `end` itself, one first on
>    an unknown key). They now say `'null'`, as do the 8 invalid fixtures that
>    used it (three loop-body fixtures were refused by the reference on `end`
>    before it reached the rule they test).
>
>    The reference's reachability and cycle walks still skip `end`, so a flow
>    that routes to a real step named `end` saves, and that step is reported
>    `unreachable_step`. That is reproduced: the spec now carries two sets,
>    `nextMarkers` (`null`, `orchestrator`: the save door) and
>    `reachabilityTerminalMarkers` (`null`, `end`, `orchestrator`: the walks).
>
> 2. **Unknown keys are refused at every level (`unknown_yaml_key`), and a value
>    of the wrong kind is `invalid_type`.** See [Unknown keys and value
>    kinds](#unknown-keys-and-value-kinds). The key sets are derived from the
>    reference's own types, not hand-listed. On the 216 bundled flows the new
>    rule fires **zero** times. `valid-branching.yaml` carried a nested
>    `constraints:` block the reference refuses; its two keys now sit at the
>    flow root, where the reference reads them.
> 3. **A number in a Go `string` duration field is judged by its source text.**
>    yaml.v3 fills such a field with the scalar's text, so `delay: 0.0` arrives
>    as `"0.0"` (no unit, refused). `parseFlow` now records the source spelling
>    of every number and boolean scalar (`scalarSources`), and `validateFlow`
>    uses it. Measured for a mock delay: `0`, `+0`, `-0`, `100ms` and `"0"` save;
>    `0.0`, `00`, `0x0`, `.0`, `-0.0`, `0.`, `0o0`, `0_0`, `1.5`, `100`, `1e3`,
>    `true` and `.inf` are refused. The same mechanism closes four more gaps the
>    probe found in the same family, each of which skipped numbers entirely:
>    `for_each.throttle.delay`, `throttle.batch_delay` and `error_strategy.max_delay`
>    (`100`, `1.5`, `0.0` were accepted, and are refused by the reference) and an
>    orchestrator timer `interval: 0` (refused here as "no interval"; the
>    reference saves it). **Divergence #13 is narrowed** to `validateFlowObject`,
>    which never sees source text.
>
> Two parse changes keep the unknown-key rule from refusing flows the reference
> saves: `merge: true` (yaml.v3 honours `<<: *anchor`, and without it `<<` was a
> literal key), and a step id written as a number (`1:`) was already fine here.
>
> Cross-check over the reference's `example_flows/` (216 files): with
> `strictRegistries` the verdict matches on all 216, and `unreachable_step`
> 25 = 25 and `potential_infinite_loop` 1 = 1. In default mode the same 10 files
> as before differ (unknown template functions warn here, divergence #4).

> v2.738.0 — **five older save-door refusals, and one false positive removed
> (package 0.13.0).** No grammar change, so `specVersion` stays `2.738.0`: every
> rule below predates it and was simply never ported. The Go port
> (`go-aigentflow-validator`) carried them first. Each was checked against the
> reference's **strict save parser** (`NewStrictFlowParser().ParseFromYAMLBytes`,
> then `ValidateFlowWithDetails`) with a refused shape and an accepted shape, and
> each invalid conformance fixture was re-run with only the offending value
> corrected, to confirm it then saves.
>
> 1. **`reserved_step_id_orchestrator`** (v2.484.0, DC-COND-1). A top-level step
>    may not be called `orchestrator`: it is the engine's step id for
>    orchestrator signals and a reserved `next:` marker. Case-sensitive
>    (`Orchestrator` saves), top-level steps only. `basicStructure.ts`.
> 2. **`tool_discovery_invalid`** (DC-FORGE-48). On the flow root, the
>    orchestrator, and a step `query`, the value must be `eager`, `lazy` or
>    `off`. Empty, null and templated values are skipped. The first two are Go
>    `string` fields, which yaml.v3 fills from any scalar, so `tool_discovery: 5`
>    or `true` is refused there. In a step `query` only a YAML string is judged.
>    `saveDoor.ts`.
> 3. **`mock_delay_invalid`** (DC-FORGE-51). A `mock_scenarios.<scenario>.<step>.delay`
>    must pass `time.ParseDuration`. `100` is refused and `100ms` saves. Every
>    step key is checked, including one the flow does not define, because the
>    reference walks the scenario map. `saveDoor.ts`. See divergence #13 for
>    the one spelling family that cannot be told apart here.
> 4. **`output_param_empty`**. An `output:` entry may not be `''`. A YAML null
>    entry is **not** refused: yaml.v3 drops null list entries while decoding,
>    so the reference never sees it. `saveDoor.ts`.
> 5. **`campaign_no_child_flows`, `campaign_child_flow_no_id`**
>    (`CampaignConfig.Validate`). `campaign.child_flows` needs at least one entry,
>    and each entry needs a non-empty `flow_id` or `flow_name`. Null entries are
>    dropped before the check, as in (4): `[~]` is empty, and a null beside a real
>    entry is ignored. `flow_id: 123` names a flow (a string field). A
>    non-list `child_flows` or a non-mapping entry is `invalid_type`.
>    `orchestratorCampaign.ts`.
>
>    The other `CampaignConfig.Validate` checks (`max_concurrent`, `max_depth`,
>    `max_total_children` must each be `>= 1`) are **not ported, because no
>    document can reach them**. `ApplyDefaults` runs first and replaces every
>    value `<= 0` with a positive default. Measured: `max_concurrent: 0`,
>    `-3`, `max_depth: 0.5` and `-1e30` all save.
>
> **False positive removed: `campaign.max_credits_per_child: 1.5` saves.**
> The field is a Go `int64`, and yaml.v3 decodes a float into an int field by
> truncating toward zero. Measured on the strict save parser: `1.5` is stored as
> `1`, `0.9` and `-0.5` as `0` (which then passes the `>= 0` check), and `1e3`
> as `1000`. All of them save. `-1`, `-1.5` and `-.inf` are refused by the
> `>= 0` check. A string (`"5"`), a boolean, `.nan`, `.inf`, and any float at or
> above 2^63 (`9.3e18`, `1e30`) fail to decode. Until now this validator refused
> every non-integer as `invalid_type`, which made it stricter than the door it
> predicts.
>
> **`parseGoDuration` is now a line-for-line port of `time.ParseDuration`**,
> using integer arithmetic with Go's overflow rules. The old version summed in
> floating point and was approximate near the int64 limit
> (`9223372036854775807ns` saves, `9223372036854775808ns` does not). This also
> affects every other duration rule that uses it (throttle, timer interval,
> `human_question_timeout`, step `max_duration`, error-strategy delays). None of
> their verdicts change outside that boundary.
>
> Cross-check over the reference's `example_flows/` (216 files; the reference
> run through its strict save parser, then `ValidateFlowWithDetails`):
> `unreachable_step` 25 = 25 and `potential_infinite_loop` 1 = 1, with identical
> `(file, field)` pairs. With `strictRegistries` the verdict matches on all 216
> files (206 valid on both sides). In default mode the same 10 files as before
> differ, for the reason given in the 0.12.0 note. 115 of the 216 files use
> `mock_scenarios`, `tool_discovery` or `child_flows`, and none of the new rules
> fires on any of them. The reference's parser, validator, flow, step, campaign,
> orchestrator, input-schema and template-registry sources are unchanged from
> `v2.738.0` to `v2.745.0`.

> v2.738.0 — **merge train (package 0.12.0).** The ten open parity PRs (#6–#12,
> #14–#16) landed together, and `specVersion` moved from `2.642.0` straight to
> `2.738.0`. Several of those PRs recorded a `specVersion` that deliberately
> understated, because each was cut from a `main` that lacked the others. That
> reconciliation is now done, and those notes are removed. The per-version notes
> below keep their original "no grammar change" wording as history.
>
> `2.738.0` is claimed because every grammar change between `v2.642.0` and
> `v2.738.0` that affects a static verdict was audited against the reference and
> is now ported, apart from the documented divergences. Three gaps turned up in
> review and are closed in the same train:
>
> 1. **`loop_sub_step_id_reserved`** (v2.648.0, warning). A loop sub-step whose
>    id is `iterations`, `break`, `vars` or `duration_ms` collides with the loop
>    result's own summary field, so `{{ .data.<loop>.<id> }}` reads the summary.
>    Field `steps.<id>.loop.steps`, attributed to the parent step, as upstream.
>    Like the rest of the loop-body walk, this validator checks every step, where
>    the reference only walks steps reachable from `start`. It is a warning either
>    way, so no verdict changes.
> 2. **`campaign.budget_max_per_child`** (v2.728.0, error). Retired for
>    `max_credits_per_child`. The strict decoder refuses it and
>    `retiredGrammarKeys` attaches advice, so it is reported as
>    `unknown_yaml_key`, like the other retired keys in `retiredKeys.ts`.
> 3. **`campaign.max_credits_per_child`** (v2.728.0, error). It is a Go `int64`,
>    so a non-integer fails to decode (`invalid_type`), and `CampaignConfig.Validate`
>    refuses a negative value (`campaign_invalid_max_credits_per_child`). Absent,
>    `null` and `0` mean "no per-child cap".
>
> One false positive was also fixed: `orchestrator.human_question_timeout: ""`
> (or `null`) was refused here, but the reference treats both as absent.
>
> The corpus cross-check then found two older defects, both fixed here:
>
> - **Seven orchestrator tool names were missing** from `orchestrator.tools`:
>   `aif_memory_recall`, `aif_memory_reflect` and the five `aif_e2b_*` tools.
>   The reference's `IsValidOrchestratorToolName` accepts all of them, so under
>   `strictRegistries` this validator refused eight bundled flows the reference
>   saves.
> - **Divergence #4 was not true for template functions.** By default the
>   function lookup was skipped, so an unknown function produced no finding at
>   all. It is now a `template_function_unknown` warning by default and an error
>   under `strictRegistries`, as #4 says.
>
> Cross-check over the reference's `example_flows/` (216 YAML files, the reference
> run through `ValidateFlowWithDetails`): `unreachable_step` 25 = 25 and
> `potential_infinite_loop` 1 = 1, with identical `(file, field)` pairs. With
> `strictRegistries`, the valid/invalid verdict matches on all 216 files (206
> valid on both sides). In default mode the 10 files the reference refuses for an
> undefined template function are valid here and carry the warning instead.
>
> Still not ported, and older than this window: the rest of
> `CampaignConfig.Validate`. Ported in package 0.13.0 (note above), apart from
> the `>= 1` checks, which no document can reach.

> v2.648.0 — **the loop body is walked.** ⛔ The reference's `validateStepsInOrder`
> iterates `flow.steps`, and a `loop:` step's sub-steps live in a SECOND step table
> — so until v2.648.0 **no template and no operation shape inside a loop sub-step
> had been examined by either implementation.** This validator inherited the same
> blind spot and recorded it as a scope note, which is what that note was for.
>
> ⚠️ **Read it as a capability statement about the defects it PERMITS.** Turning
> the walk on in the reference produced ten syntax findings across five of its own
> shipped example flows, behind which sat five engine defects — including three
> template functions (`atoi`, `mod`, `int`) that five bundled flows used and the
> registry did not have. Those three are now in `templateFunctions`.
>
> 1. **Every loop-body finding is a WARNING, never an error.** ⛔ The reference
>    consults this validator at its RUN door over flows stored long before the
>    walk existed. ⚠️ The "the run already died anyway" licence that would make an
>    Error safe requires the failing path to be UNCONDITIONAL, and inside a loop
>    body four of the six evaluation sites SWALLOW a template failure and carry on
>    with the raw string. The CODE survives the demotion; only the severity
>    changes — dropping the finding would be worse than raising it.
> 2. **The dispatch set is a PARTITION, never a union.** `loop.set` / `loop.break`
>    are dispatched by `executeLoopPostProcessing` and are legal ONLY on a loop
>    sub-step; at the top level they remain undispatchable, and a merged set would
>    silently accept a flow that fails at run time. `dispatchableOperationTypes`
>    takes the scope as a parameter for exactly that reason, and both halves have
>    their own fixture.
> 3. **Findings are attributed to the PARENT step id** — the id every other
>    surface knows this work by — with the sub-step named by its index in the
>    field path (`steps.<id>.loop.steps[i].…`), matching the reference.
>
> v2.647.0 — **a processing operation's SHAPE is now checked: the operation type,
> and the config keys its handler reads.** Both verdicts are **warnings** in the
> reference and here, which is the point of them: a flow carrying either mistake
> saves and runs. An operation type the engine has no dispatch case for fails at
> run time with "unsupported operation type"; a config key the handler never reads
> is simply ignored, so `transformation:` written where the handler reads
> `transformer:` produces a step that succeeds and does nothing. Ported into
> [`src/validators/processingOperations.ts`](./src/validators/processingOperations.ts),
> which also now owns the ONE decomposition of a processing operation —
> `templates.ts` shares it, so the `if:` guard is recognised in a single place.
>
> 1. **`unknown_processing_operation`.** The dispatchable set in a top-level
>    step's `pre_processing:` / `post_processing:` is `data.set`,
>    `conversation.append`, `output.set`, `binary.store`, `binary.get`,
>    `binary.update`, `binary.delete`, `binary.transform`, `parse`. `loop.set` and
>    `loop.break` are handled by a loop sub-step's post-processing before it
>    delegates, so they are dispatchable **only there** — and are correctly
>    reported as undispatchable at the top level. The two scopes are kept apart
>    rather than merged for the same reason the key sets are (below): a name in
>    the wrong half is the failure mode, and no merged set can see it.
>
>    The operation type is the YAML **map key** (`- data.set: { … }`), not a
>    field, so the finding addresses the operation itself
>    (`steps.<id>.post_processing[0]`). Naming an `operation_type` field would
>    send an author looking for something the grammar does not have. An unknown
>    type also suppresses the key verdict beneath it: one verdict per defect.
>
> 2. **`unknown_processing_config_key`**, for the operations with a **closed** key
>    set — `parse`, `binary.store`, `binary.get`, `binary.update`,
>    `binary.delete`, `binary.transform`, `loop.break`. The sets are **per
>    operation and are never unioned**: `asset_id` is read by
>    `binary.get`/`binary.update`/`binary.delete` and is **not** read by
>    `binary.transform`, which reads `source_asset_id`. A union over the
>    operations accepts that key in the wrong half, which is precisely the
>    mistake the rule exists to catch, so the spec models each operation
>    separately and a conformance fixture pins the wrong-half case.
>
>    `data.set`, `output.set`, `conversation.append` and `loop.set` have **open**
>    key sets — every key is a name the author chose (a data key, an output key, a
>    conversation id, a loop variable) — so "unknown key" is not a notion that
>    applies to them and they can never produce this warning. That half is what
>    makes the rule safe; asking them for a known key set would accuse every
>    correct flow. The `if:` guard is a **sibling** of the operation key rather
>    than a config key, except on `loop.break`, where `if` IS its config key.
>
>    Scope, stated so it is not mistaken for more: **top-level config keys only**.
>    Sub-keys of `metadata:` (forwarded to the asset store, which has its own
>    vocabulary) and of `parameters:` (the transformer's, which varies per
>    transformer) are out of scope in both implementations.
>
> Verified by running the reference validator over the new fixtures: identical
> codes and identical field paths, and the all-correct fixture produces neither
> code on either side.
>
> New conformance fixtures: `valid-processing-operation-unknown-type-warns.yaml`,
> `valid-processing-config-key-wrong-half-warns.yaml`,
> `valid-processing-config-keys-accepted.yaml`. The third needed a new
> `forbidWarningCodes` assertion in the conformance harness: a rule whose whole
> risk is a false positive needs a fixture that goes **red** when it fires, and
> `valid: true` does not say that, because a warning never changes the verdict.

> v2.652.0 (DC-FORGE-82; no grammar change, so `specVersion` stays `2.642.0`) —
> **one new static rule ported: `loop_substep_error_goto_ignored`.** A loop BODY is
> a second step table, and the walk that raises `unreachable_error_goto` never
> entered it — **on either side**; this validator had the same blind spot as the
> reference, for the same reason, which is why the finding ports rather than
> diverges.
>
> ⛔ **It is a DIFFERENT finding from `unreachable_error_goto`, and collapsing the
> two would be wrong.** That one is about a `goto_step` beside the wrong action,
> and its remedy is to write `action: "goto"`. Inside a loop body there is no
> action that helps: `executeLoopStep`'s failure switch has exactly two arms —
> `continue` (skip to the next sub-step) and a default that ABORTS the whole loop
> step — so `goto` lands in the default and the loop fails. **The strategy the
> author chose in order to avoid failing is the one that fails.** The message names
> the real remedy: put the `goto_step` on the LOOP step, whose own `error_strategy`
> is what the abort routes through.
>
> ⚠️ **Only the new warning is emitted over loop sub-steps — deliberately.** The
> reference's parser does not run its `error_strategy` checks (action enum, goto
> target existence, duration and backoff validation) over a loop body at all, so
> routing sub-steps through `validateOne` would make this oracle refuse shapes its
> door accepts — wrong in the more damaging direction.
>
> The fixture pair follows the `forbidWarningCodes` discipline established below.
> The counter-fixture puts a `goto_step` on the LOOP step beside `action: goto` —
> the exact shape the warning's own advice produces — so a rule that fired on any
> `goto_step` near a loop would make its own remedy warn. Both directions are
> mutation-verified: deleting the emission fails the positive fixture, dropping the
> `goto_step` presence guard fails the counter-fixture.
>
> The rest of v2.652.0 is out of scope: a composite step's `*StepError`, the
> one-hop `.step.error` carry into a for_each/loop handler, the loop sub-step
> strategy resolver and the unchecked `map[string]any` assertion are all engine
> runtime behaviour (divergence #3), not static grammar.

> v2.651.0 (DC-FORGE-81; no grammar change, so `specVersion` stays `2.642.0`) —
> **one new static rule ported: `unreachable_error_goto`.** The reference's engine
> switches on `error_strategy.action` and reads `goto_step` in the `goto` branch
> **only**; `retry`, `fail` and an absent action all fall through to failing the
> mission. Its parser has always checked that a `goto_step` names an existing step
> — but only once the action already was `goto`, so the one combination that
> silently does nothing was the one combination nothing asked about. ⛔ **Both of
> the reference's bundled example flows declared `action: "retry"` beside a
> `goto_step:` naming an error handler**, so neither handler was reachable, which
> is also why several broken `.step.error` reads inside those handlers had never
> been noticed — the steps containing them never ran.
>
> It is a **warning** on both sides, for the same reason: the reference consults
> this validator at its RUN door over flows that are already stored, and the
> declaration is INERT rather than fatal.
>
> ⭐ **The fixture pair is the point, and `forbidWarningCodes` is new here because
> of it.** This rule's entire risk is a FALSE POSITIVE, and neither `valid` nor
> `expectWarningCodes` can express that: a warning never changes the verdict, so an
> all-correct fixture stays green no matter how indiscriminately the rule fires.
> `valid-reachable-error-goto.yaml` forbids the code; without that assertion the
> suite passes with the rule's guard deleted. Both directions are mutation-verified.
>
> The rest of v2.649.0–v2.651.0 is out of scope: v2.649.0 is SPA styling, and
> v2.651.0's other five findings are runtime template-context behaviour
> (divergence #3), engine routing, or documentation surface.

> v2.672.0 (DC-FORGE-102, aigentflow#116; no grammar change, so `specVersion`
> stays `2.642.0`) — **three new static rules ported: a loop sub-step's `next:`
> targets are now checked.** A `loop:` sub-step may carry its own `next:` block,
> and its targets — `next.default` and every `next.conditions[].goto` — resolve
> ONLY against the sub-step ids of the SAME loop.
>
> ⛔ **Nothing checked them, on either side.** `validateNextLogic`,
> `validateOrchestratorNext` and this validator's connectivity pass all walk
> `flow.steps` only, and **a loop body is a SECOND step table** — the distinction
> this family of defects keeps being about. So `goto: pol` for a sub-step called
> `poll` saved clean, stored, and surfaced at run time as a WARN followed by a
> silent sequential advance: the branch the author wrote simply never happened,
> in the one construct whose entire purpose is branching.
>
> Three refusals, each with its own code, each a shape the runtime cannot act on:
>
> 1. **`loop_substep_next_target_not_found`** — the target names no sub-step of
>    that loop. ⭐ **The interesting miss is a target that names a real TOP-LEVEL
>    step**, which looks correct to every reader and to every previous check, and
>    which the loop driver cannot see.
> 2. **`loop_substep_next_sentinel`** — the target is `null` or `orchestrator`.
>    The reference's `resolveLoopSubStepNext` has no sentinel awareness at all, so
>    `null` cannot end a mission from a loop body and `orchestrator` cannot yield;
>    both take the same miss path as a typo. (This is also why the reference's
>    `flowHasOrchestratorYieldEdge` skipping loop bodies is correct rather than a
>    bug: the edge is unreachable, so the fix is to refuse WRITING it.)
> 3. **`loop_substep_next_parallel`** — the sub-step declares `next.parallel`. The
>    loop driver reads conditions and default only, so the block never fans out
>    and its rendezvous never runs.
>
> **Both jump directions stay legal** — the runtime sub-step index covers the
> whole loop, not only the sub-steps declared earlier — which is why the check
> runs as a SECOND pass over the already-collected id set, and why the valid
> fixture carries a forward jump AND a backward one. **An empty target is the
> documented "advance sequentially" and is left alone.**
>
> ⚠️ **`end` is reported as a missing target, not as a sentinel.** The reference
> names only `null` and `orchestrator` and lets everything else fall through to
> the existence check, and that is the honest answer inside a loop body, where
> nothing reads `end` either. (Since 0.14.0 the same is true of top-level next
> targets; divergence #2 is closed.)
>
> **Severity: all three are `error` here.** Upstream they are hard refusals at the
> SAVE door and downgraded to a warning on the stored-flow LOAD door, so a flow
> written before the rule keeps running exactly as degraded as it already was.
> This validator has no notion of doors and answers **"would this save"** — the
> same choice already made for the executor-URL shape and expression-function
> catalog rules. **No new severity was invented, and a refusal here does not imply
> a broken running flow.**
>
> ⭐ **`forbidErrorCodes` is new in the conformance harness.** `valid: true`
> already fails on any spurious error, so this is not the verdict-shaped hole
> `forbidWarningCodes` fills for a warning rule — it NAMES the rule under test, so
> a regression reads as "the loop-target rule fired on a legal backward jump"
> instead of as an anonymous count mismatch. All five mutants (drop the existence
> check, make an empty target illegal, drop the sentinel set, drop the parallel
> check, judge targets single-pass so a forward jump is refused) are killed by
> both a unit test and a conformance fixture.
>
> New conformance fixtures: `valid-loop-substep-next.yaml`,
> `invalid-loop-substep-next-unknown-target.yaml`,
> `invalid-loop-substep-next-sentinel.yaml`,
> `invalid-loop-substep-next-parallel.yaml`.

> DC-FORGE-145 (the release after v2.715.0; no grammar change, so `specVersion`
> stays `2.642.0`) — **one new static rule ported: `response_expectation_unread`.**
> The reference's engine reads a step's `response_expectation` only when
> `response_evaluation` is set; with no evaluation mode it returns the raw response
> untouched, so the expectation's `required`, `type` and `fallback` are never
> consulted. The reference measured **21 such steps in 9 of its own bundled flows**,
> including a requirement meant to fail an answer that had not searched.
> `async://` is exempt because its respond route validates the posted output
> against the expectation on its own. Loop sub-steps cannot declare an
> expectation, so — unlike `unreachable_error_goto` — there is no loop-body walk.
>
> It is a **warning** on both sides: the reference consults it at its RUN door over
> flows that are already stored, and the declaration is inert rather than fatal.
> The message text is the reference's `WARN_MSG_RESPONSE_EXPECTATION_UNREAD`
> verbatim, with Go's `%q` rendered as `JSON.stringify` (identical for printable
> ASCII, which is all a step id holds).
>
> Parity was measured, not assumed: over the reference's bundled corpus **before**
> its fix, this validator and the reference emit the **identical** 21
> `(flow, step)` findings; after it, both emit zero. Three counter-fixtures
> (`raw-text`, `async://`, absent/empty expectation) carry `forbidWarningCodes`, and
> each of the rule's four guards is mutation-verified against them.

> DC-FORGE-147 (no grammar change, so `specVersion` stays `2.642.0`) — **one new
> static rule ported, a warning: `step_max_duration_ignored`.** The reference now
> bounds each executor invocation of a step by its `max_duration`. Two
> declarations fall outside that, each warned on at `steps.<id>.max_duration`:
>
> - a value that is not `none`/`never`/`infinite` and does not parse as a Go
>   `time.ParseDuration` string (`2d`, `5 minutes`, a `{{ template }}`, a bare
>   `90`) — the engine runs that step with **no** time limit rather than fail a
>   stored flow at its run door;
> - a parseable value on a `loop:` step, which makes no executor call of its own.
>
> Only top-level steps are walked: loop sub-steps have no `max_duration` field in
> the reference. `0s` and negative values parse (the engine treats them as no
> bound) and do not warn. Both messages are the reference's
> `WARN_MSG_STEP_MAX_DURATION_UNPARSEABLE` / `_LOOP` verbatim, with `%q` rendered
> as `JSON.stringify`. The reference sets no `StepID` on this warning, so neither
> does this port.
>
> The shared `parseGoDuration` helper was brought into line with Go on two edges
> it got wrong: `1.s` (digits on one side of the point suffice) now parses, and a
> value overflowing int64 nanoseconds (`2562048h`) no longer does. The unit test
> pins 28 strings against `go run` output. This also tightens `invalid_duration`
> on throttle `delay`/`batch_delay` and error-strategy delays, toward Go.
>
> Divergences, none of which changes a verdict: the reference's field is a Go
> `string`, so YAML decodes any scalar into it; this port reads a string or a
> finite number (as its decimal text) and ignores booleans/mappings. A YAML
> number's original spelling (`0x10`) is lost at parse here, so its text may
> differ in the message. The overflow boundary is float-approximate to within a
> few ns of 2^63.

> AIF DC-FORGE-150 (v2.721.0) — **three grammar keys deleted because nothing read them: the top-level
> `budget:`, the top-level `max_retries:`, and a `max_retries:` directly on a
> top-level step.** Measured inert on the reference's real engine before the
> deletion: a sub-cent `budget` completed a step that cost 2.0, and step
> `max_retries: 0` still made two attempts. The reference's save door parses with
> `KnownFields(true)`, so a flow declaring any of them is now **refused at save**,
> with migration advice from its `retiredGrammarKeys` table (parser.go); stored
> flows still load leniently and run.
>
> Ported as an **error** with the code this validator already uses for the other
> key the reference refuses specifically, `unknown_yaml_key` (the
> `next.conditions[].goto_step` case below) — new module
> [`src/validators/retiredKeys.ts`](./src/validators/retiredKeys.ts). Fields:
> `budget`, `max_retries`, `steps.<id>.max_retries`. The check is on key
> **presence**, not value: the strict decoder refuses the key whatever it holds, so
> `budget: 0`, `max_retries: 0` and `budget: null` are all refused. The message
> names the version, says AIgentFlow refuses to save it, and the suggestion names
> the replacement — `billing: { max_credits: N }` with its reach (it caps the
> credit reservation and refuses further agentic turns: agentic `ai://`,
> `exons://`, the orchestrator; plain chat steps and `flow://` sub-flows are not
> checked against it), or `error_strategy: { action: "retry", max_retries: N }`
> (N counts attempts, including the first).
>
> **Loop sub-steps are included** (`steps.<id>.loop.steps[<i>].max_retries`). The
> reference's loop sub-step type never had a `max_retries` field, so it was always
> refused there as an unknown key, independently of this deletion — and because
> the advice table matches the key NAME in the decoder error, not the type, the
> reference now attaches this same advice to it. Reporting it is therefore parity
> with "would this save", not an extension; it is the one location where this
> validator reports a generic unknown key, and it does so only because the
> reference names it.
>
> The false positive to guard is the working key one level down:
> `error_strategy.max_retries` (flow and step), `quality_gate.max_retries`,
> `billing.max_credits`, and the surviving `currency` / `max_duration`. The
> counter-fixture `valid-limit-keys-one-level-down.yaml` carries all of them;
> because this is an ERROR rule, `valid: true` (zero errors) is the proof and no
> `forbid*Codes` harness extension is needed. Four mutants were run and each was
> killed: presence→truthiness (skips `0`/`null`; 5 tests fail), the step rule also
> reading `error_strategy.max_retries` (2 fail), the budget rule also firing on a
> `billing:` block (2 fail), and not walking loop sub-steps (1 fails).
>
> `budget` and the flow-level `max_retries` are also removed from the exported
> `Flow` type (they were never on `StepDefinition`). `ErrorStrategyDefinition.
max_retries` and `QualityGateDefinition.max_retries` are unchanged. Removing
> public type fields is why the package version is a minor bump.
>
> **Supersedes the DC-FORGE-146 warnings** (`flow_budget_unenforced`,
> `max_retries_unread`) proposed in an open PR for the same three keys: the keys no
> longer exist, so there is nothing left to warn about.
>
> Divergence, none of which changes a verdict on a flow the reference would save:
> the reference refuses a `budget` or `max_retries` key at ANY depth where the
> containing type has no such field (the generic unknown-key rule, ported in
> 0.14.0 — see [Unknown keys and value kinds](#unknown-keys-and-value-kinds)).
> The four locations above keep their specific advice.

> v2.646.0 (no grammar change, so `specVersion` stays `2.642.0`) — **the reference
> finally validates `pre_processing:` / `post_processing:` templates at all.** Its
> `validateProcessingOperation` took `operation any` and asserted `map[string]any`
> while both call sites passed `*ProcessingOperationDefinition`, so it returned
> silently for the life of the repository. ⭐ **This validator has checked those
> blocks for syntax the whole time, which means the port was STRICTER than the
> reference it ports** — the opposite of the direction a mirror is usually wrong in,
> and invisible to both sides.
>
> What changed here: nothing about _what_ is reported, only _where_. The reference
> unmarshals a processing operation's single key into `OperationType` and its body
> into an inline `Config`, so it addresses findings as
> `steps.<id>.post_processing[0].<configKey>` and `steps.<id>.post_processing[0].if`.
> This validator walked the raw record and inserted the operation name as a path
> segment (`…post_processing[0].data.set.<configKey>`). The walker now matches the
> reference, pinned by a test that fails on the old address.
>
> The reference also gained `template_missing_field` coverage inside those blocks,
> grounded on the namespaces the processing handler actually builds — which is
> **narrower** than a step's own context (no `.loop`, no `.binary`, four of five
> `.step` sub-namespaces absent, and `.step.response` only after the step, holding
> the _evaluated_ response). That whole class stays out of scope here under
> **divergence #3**, unchanged.

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
> - `ValidateExecutorConfigEnvScopes` (AIF v2.597.0) — **ported in 0.15.0**
>   (`executor_config_env_scope`, see the 0.15.0 note at the top). The four scope tables
>   are vendored as one evaluated table, `executorConfigEnvScopes.scopes` in the spec.
> - Unknown-key rejection (**ported in 0.14.0**, see
>   [Unknown keys and value kinds](#unknown-keys-and-value-kinds)). AIgentFlow's create path has always parsed with
>   `KnownFields(true)`; AIF v2.604.0 made `POST /flows/validate` and the Studio
>   assistant strict too, so "would this save" now answers the same everywhere.
>   This validator inspects no unknown keys, so a step-level `output:` block
>   (the real grammar is `post_processing: - output.set:`) still validates clean.
>   Porting it means a full field inventory of `Flow`/`StepDefinition` and
>   interacts with divergence #8. **A decision to make, not a delta.** The one
>   case that mattered in practice — `goto_step` inside a condition — is now
>   reported specifically, as are the keys AIgentFlow v2.721.0 deleted from the
>   grammar (`budget`, `max_retries` — see DC-FORGE-150 above).
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
> v2.735.0 (DC-FORGE-162, aigentflow#149): added Sprig's float names `addf`, `subf`,
> `mulf`, `divf` and `float64` to `templateFunctions`. `ternary` also accepts Sprig's
> condition-last order at runtime; that changes no name, so the allow-list is unaffected.
> Allow-list only.
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

| Area                                                                                                                    | Go source                                                                                               | JS module                                                 | Tested by                                                  |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| Required fields, start-step existence, per-step executor, reserved `.` in IDs, reserved id `orchestrator`               | `validateBasicStructure`, `ValidateFlow` head                                                           | `validators/basicStructure.ts`                            | `validate.test.ts`, `conformance.test.ts`                  |
| Executor URI shape (the ONE parser) + scheme                                                                            | `ValidateFlow` executor-URL rule (parser.go), `ParseExecutorURLString`                                  | `validators/executors.ts`                                 | `validate.test.ts`                                         |
| Query/property/array-item schema + array constraints                                                                    | `validateQueryParameters`, `validateProperties`, `validateArrayItems`, `validateArrayConstraints`       | `validators/querySchema.ts`                               | `validate.test.ts`                                         |
| Response-expectation types + array items + `required`                                                                   | `ValidateFlow` (response block), `validateSemantics`                                                    | `validators/responseExpectation.ts`                       | `validate.test.ts`                                         |
| Response expectation nothing reads (`response_expectation_unread`, warning)                                             | `validateResponseExpectationIsRead` (validation.go)                                                     | `validators/responseExpectation.ts`                       | `validate.test.ts`, `conformance.test.ts`                  |
| Error strategy (action, goto, max_delay, backoff, retry_on)                                                             | `validateErrorStrategy`                                                                                 | `validators/errorStrategy.ts`                             | `validate.test.ts`                                         |
| Retired `budget:` / `max_retries:` (flow, step, loop sub-step) and `campaign.budget_max_per_child` → `unknown_yaml_key` | `retiredGrammarKeys` + `KnownFields(true)` (parser.go)                                                  | `validators/retiredKeys.ts`                               | `validate.test.ts`, `conformance.test.ts`                  |
| `next` references (save-door sentinels `null`/`orchestrator`), reachability and cycles (`end` is an ordinary step)      | `validateNextLogic` (parser.go), `findReachableSteps`, `checkForCycles`                                 | `validators/connectivity.ts`                              | `validate.test.ts`, `conformance.test.ts`                  |
| Unknown keys at every level (`unknown_yaml_key`) and value kinds (`invalid_type`)                                       | `KnownFields(true)` over the reference's types (parser.go); `knownKeys` in the spec                     | `validators/unknownKeys.ts`                               | `validate.test.ts`, `conformance.test.ts`                  |
| `next.parallel` + orchestrator-next requirement                                                                         | `validateNextLogic`, `validateOrchestratorNext`                                                         | `validators/nextLogic.ts`                                 | `validate.test.ts`                                         |
| Expression functions (XOR package/function)                                                                             | `validateExpressionFunctions`                                                                           | `validators/expressionFunctions.ts`                       | `validate.test.ts`                                         |
| Expression-function catalog (`package:` refused, unknown `function:` refused)                                           | `validateExpressionFunctionCatalog` (parser.go)                                                         | `validators/expressionFunctions.ts`                       | `validate.test.ts`, `conformance.test.ts`                  |
| Expression-function USE (`{{ fn_* }}` must be in the catalog AND declared)                                              | `validateExpressionFunctionUsage` (parser.go)                                                           | `validators/expressionFunctions.ts`                       | `validate.test.ts`, `conformance.test.ts`                  |
| Loop / for_each / throttle                                                                                              | `validateLoop`, `validateForEach`, `validateThrottle`                                                   | `validators/loopForEachThrottle.ts`                       | `validate.test.ts`                                         |
| Loop sub-step id that shadows a loop-result summary field (`loop_sub_step_id_reserved`, warning)                        | `validateLoopSubStepIDCollision` (validation.loopbody.go)                                               | `validators/loopForEachThrottle.ts`                       | `validate.test.ts`, `conformance.test.ts`                  |
| Loop sub-step `next:` targets (same-loop only, sentinels, no parallel)                                                  | `validateLoopSubStepNext` (parser.go)                                                                   | `validators/loopForEachThrottle.ts`                       | `validate.test.ts`, `conformance.test.ts`                  |
| Orchestrator structure + campaign requires orchestrator                                                                 | `validateOrchestrator`, `validateAndNormalizeCampaign`                                                  | `validators/orchestratorCampaign.ts`                      | `validate.test.ts`                                         |
| Campaign `max_credits_per_child` (decoded as int64, >= 0), `child_flows`                                                | `CampaignConfig.Validate` (domain.campaign.go)                                                          | `validators/orchestratorCampaign.ts`                      | `validate.test.ts`, `conformance.test.ts`                  |
| `tool_discovery` vocabulary, mock scenario `delay`, empty `output:` entry                                               | `validateToolDiscoveryVocabulary`, `validateMockScenarioDelays`, `validateOutputParameters` (parser.go) | `validators/saveDoor.ts`                                  | `validate.test.ts`, `conformance.test.ts`                  |
| `executor_config` `${NAME}` references outside the key's scope (`executor_config_env_scope`)                            | `ValidateExecutorConfigEnvScopes` (parser.go)                                                           | `validators/executorConfigEnv.ts`                         | `v0150-save-door.test.ts`, `conformance.test.ts`           |
| A step or loop sub-step `query:` declaring a server-owned key (`server_owned_query_key`)                                | `validateNoServerOwnedStepQueryKeys` (validation.go), `IsServerOwnedParamKey`                           | `validators/serverOwnedQueryKeys.ts`                      | `v0151-save-door.test.ts`, `conformance.test.ts`           |
| An endpoint a server-supplied credential will never be sent to (`credential_endpoint_unpaired`, warning)                | `validateCredentialEndpointPairing`, `validateFamilyCredentialEndpointPairing` (validation.go)          | `validators/credentialEndpoint.ts`, `validators/goUrl.ts` | `v0152-credential-endpoint.test.ts`, `conformance.test.ts` |
| Orchestrator `.exons` frontmatter: spec, provider, `requirements.resources`, `tools.allow` withholds                    | `validateOrchestrator` (parser.go), `validateOrchestratorToolAllowWithholds`                            | `validators/exons.ts`                                     | `v0150-save-door.test.ts`, `conformance.test.ts`           |
| Credential bindings (`stored/...`, inject_as, exclusivity)                                                              | `validateStepCredentialBindings`                                                                        | `validators/credentialBindings.ts`                        | `validate.test.ts`                                         |
| `input_schema` definition + ordering lint                                                                               | `ValidateInputSchemaDefinition`, `LintInputSchemaFieldOrdering`                                         | `validators/inputSchema.ts`                               | `validate.test.ts`                                         |
| Step `output_schema` definition (reuses the input-schema subset)                                                        | `ValidateInputSchemaDefinition` (on `step.OutputSchema`, parser.go)                                     | `validators/outputSchema.ts` (+ shared `inputSchema.ts`)  | `validate.test.ts`                                         |
| `quality_gate:` block (rubric/threshold/on_fail/goto)                                                                   | `FlowParser.validateQualityGate` (parser.go)                                                            | `validators/qualityGate.ts`                               | `validate.test.ts`                                         |
| Processing-operation type + per-operation config keys                                                                   | `validateProcessingOperationShape`                                                                      | `validators/processingOperations.ts`                      | `validate.test.ts`, `conformance.test.ts`                  |
| Step `max_duration` the engine cannot apply (`step_max_duration_ignored`, warning)                                      | `validateStepMaxDurationIsApplied` (validation.go), `parseStepMaxDuration` (flowengine.steptimeout.go)  | `validators/stepMaxDuration.ts`                           | `validate.test.ts`, `conformance.test.ts`                  |
| Go-template syntax                                                                                                      | `validateTemplateExpression` (Parse step)                                                               | `template/gotmpl-syntax.ts` + `validators/templates.ts`   | `gotmpl-syntax.test.ts`, `validate.test.ts`                |

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

2. **Closed in 0.14.0 and 0.15.0: `end` was always a terminal marker here.** The reference
   was internally inconsistent: its structured validator exempted `end`, and its save door
   (`validateNextLogic`) did not. This port used to follow the structured validator, so
   it accepted `next: { default: end }`, which the reference refuses to save. 0.14.0
   followed each: the existence check uses the save door's set (`null`, `orchestrator`),
   and the reachability and cycle walks kept `end` as terminal, so a real step named `end`
   that only `end` routed to was `unreachable_step` on both sides.

   **Since 0.15.0 (reference v2.760.0) the second half is gone too:** no reference walk
   treats `end` as terminal, so a real step named `end` is reachable and a cycle through
   it is a cycle (`warn-next-end-cycle.yaml`). Spec `reachabilityTerminalMarkers` is now
   `["null", "orchestrator"]`, the same values as `nextMarkers`; the two keys stay
   separate so a future split is a one-value change.

3. **Runtime template field-resolution is not reproduced.** Go additionally _executes_
   each template against a mock context to emit `template_missing_field` /
   `condition_not_boolean` **warnings**. That requires simulating the runtime state graph;
   we validate template **syntax** only. (Candidate for a future best-effort pass.)

4. **Unknown orchestrator tools / template functions are warnings by default.** The
   vendored allow-lists (`orchestrator.tools`, `templateFunctions`) can lag the live
   AIgentFlow registries. Pass `{ strictRegistries: true }` to make them errors.

5. **Narrowed in 0.15.0: the orchestrator exons document is read, its body is not
   parsed.** The frontmatter is read the way the engine extracts and decodes it (see the
   0.15.0 note at the top), so the spec's presence, `execution.provider`,
   `requirements.resources` and `tools.allow` are judged as the reference judges them.
   Whether the document as a whole parses, and whether its tags render, needs the
   engine: divergence #16.

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
    rejects for an unrelated reason, and since 0.14.0 this validator refuses that document
    too (`unknown_yaml_key`). Same family as divergence #8, and strictly additive.

    Severity: the catalog and usage rules are refused at AIgentFlow's SAVE door and only
    warned at its load/run door, so a flow stored before the rules existed keeps running.
    This validator answers "would this save" and therefore reports all of them as
    `error` — the choice already made for the executor-URL shape rule. That is parity
    with the save door, not a divergence, but it means a refusal here does **not** imply
    a broken running flow.

11. **A malformed processing-operation entry produces no shape verdict (v2.647.0).**
    The reference's custom unmarshaller refuses an entry that is not a map, that
    carries more than one non-`if` key, or whose config is not a mapping — those
    flows never reach the rules above, because they fail to parse at all. This
    validator has no typed unmarshal, so such an entry simply yields no
    operation to have an opinion about and both rules stay silent; the
    structural pass keeps whatever it already said. Same family as divergence
    #8, in the lenient direction.

    Scope note, resolved in v2.648.0: both implementations now walk the loop body
    as well, with `loop.set` / `loop.break` dispatchable there and undispatchable
    at the top level.

12. **`orchestrator.human_question_timeout` — the refusal is ported, the WARNING is not.**
    AIF v2.695.0 (DC-FORGE-125, aigentflow#124) adds an opt-in per-question HITL deadline. The
    reference refuses an unparseable **or non-positive** duration, and this validator does the same
    — note the positivity half: `-5m` is a well-formed Go duration, so a bare `isValidGoDuration`
    check would accept what the door refuses, and an oracle **looser** than its door is wrong in the
    more damaging direction.

    The reference ALSO logs a server-side warning (a log line, not a validation warning) when the declared timeout exceeds `ORCH_MAX_MISSION_DURATION` (the
    orchestrator's 60-minute runaway guard), because a deadline the mission clock outlives can never
    fire. That is **not** ported: the threshold is a deployment-side constant this package cannot
    observe, and hard-coding it here would put a second copy of an AIgentFlow number in another
    repository — the drift this file exists to prevent. A flow that declares an over-long timeout is
    therefore `valid` on both sides; only the reference's server log mentions it.

    ⚠️ Absent means **no deadline**, in both — and an empty string or YAML `null` counts as absent, because
    the reference's field is a Go string and its check runs only on a non-empty value. This validator must never infer a default: the
    reference treats a default here as a policy nobody chose, and inventing one would make the
    oracle refuse or accept on a premise the door does not hold.

13. **Narrowed in 0.14.0 and 0.14.1: a number in a Go `string` field is judged by
    its source text only when there is source text.** yaml.v3 fills the reference's
    `string` field with the scalar's **source text**. `validateFlow` now has it
    (`parseFlow` records the spelling of every number and boolean scalar, and gives
    every number or boolean mapping key its spelling), so `delay: 0.0`, `00` and
    `0x0` are refused as the reference refuses them, and `default: 1e3` names the
    step `"1e3"`. Two cases still see only the parsed value: `validateFlowObject`,
    whose caller parsed the document, and a value reached through a YAML alias.
    There a number is rendered the way JavaScript renders it (`0.0` is `"0"`, `1e3`
    is `"1000"`, `0x1F` is `"31"`), which is also how JavaScript renders a numeric
    object key, so an ordinary `2` still names the step `2`. For durations this is
    the lenient direction: every other number is refused either way, because no
    number's text carries a unit.

    Since 0.14.1 the mechanism covers every Go `string` field the validators read:
    step references (`next.default`, condition `goto`, `parallel.steps` and
    `rendezvous`, `error_strategy` / `quality_gate` `goto_step`, `start`,
    `campaign.on_children_complete`, loop sub-step ids and `next` targets), enums
    (`action`, `retry_on`, `on_fail`, `resolution`, `mode`, trigger `type`, data
    types, `tools`), names and required text (`name`, `aigentflow_version`,
    `executor`, `rubric`, `items`, `while`, `exons`, credential `source` /
    `inject_as`, input-schema `name` / `type` / `pattern` / `visible_when.field`,
    `expression_functions` values, `response_evaluation`, `flow_id` /
    `flow_name`), and the durations (`delay`, `batch_delay`, `max_delay`,
    `retry_delay`, timer `interval`, `human_question_timeout`, `max_duration`,
    `tool_discovery`).

_Numbers 14 and 15 are the Go port's own (its #14 collects reference checks outside both
ports' scope, such as plugin pre-validation; its #15 is #13 here). From 16 on, both ports
number their shared divergences alike._

16. **`.exons` documents: the engine's judgement needs the engine (0.15.0; Go port #16).**
    The reference judges an inline `.exons` document with go-exons: whether it parses
    (grammar, frontmatter decode and the spec's own validation), and whether every tag
    can render. This validator has no `.exons` template engine and must not grow one,
    because a second implementation of that grammar is a second opinion about it. The
    frontmatter reader makes `orchestrator_exons_parse_failed` (no spec, an unclosed
    frontmatter, the retired config block), `orchestrator_exons_no_provider`,
    `exons_resources_unhonoured` and `orchestrator_tool_withheld` the reference's. What
    it cannot see:
    - `exons_attributes`: a tag the engine's resolver refuses at execute
      (`{~exons.message~}` without `role=`, `{~exons.include~}` without `template=`),
      on a step's inline `query.exons` and on the orchestrator. The step rule is not
      ported at all: with no engine it has nothing to judge.
    - a document that does not parse for any other reason, including a spec the engine's
      own validation refuses (a missing `description`), and a frontmatter whose declared
      fields have the wrong shape (the reader then judges nothing);
    - a frontmatter containing a tag, which the engine executes before decoding.

    **Direction: looser, never stricter.** The reader refuses only where the engine
    refuses as well; the Go port pins that with a 15-shape matrix against go-exons, and
    this repository pins the same 15 plus 24 decode shapes against the Go port's verdicts.
    The engine-only fixtures (`invalid-exons-step-attributes.yaml`,
    `invalid-orchestrator-exons-attributes.yaml`,
    `invalid-orchestrator-exons-spec-invalid.yaml`) state the reference's verdict and are
    marked `exonsEngineOnly`: this suite asserts the looser one (valid, none of the
    engine's codes). The Go port offers its engine as an optional companion module; there
    is no JavaScript equivalent.

17. **`input_schema_file_after_parametric` is spelt `INPUT_SCHEMA_FILE_AFTER_PARAMETRIC`
    by the reference (Go port #17).** The reference's save door merges its `input_schema`
    ordering lint into the verdict with its own upper-case code, at field `doc`. Both
    ports have always reported it as `input_schema_file_after_parametric` at the offending
    field (`input_schema.fields[N]`). A warning only; renaming a published code would break
    every consumer that branches on it, so it stays.

18. **`credential_endpoint_unpaired`: what the static rule cannot see (Go port #19).** The
    reference's save-time rule is itself static and is ported exactly. What it predicts is
    a RUN-TIME refusal that reads what no document carries: the values of the server's
    environment variables, the credential resolver's output (which stored key, with which
    base URL), the service configuration an executor fills, and whether a client attaches
    the deployment's service credential. Neither side reads them statically.
    - **Default endpoints of rows the rule never reads are not carried** (`getmd://`, which
      is never judged, and `nexus://`, whose shape consults no default). Verdict-neutral.
    - **A `credentials:` mapping with a non-string key (looser, shared).** The reference
      decodes it into `map[any]any`, which its nexus own-key check does not accept, so the
      endpoint warns there; both ports stringify mapping keys and see a key of the step's own.
    - **JS only, looser: an endpoint shaped like a YAML timestamp is not read as a string.**
      yaml.v3 decodes a PLAIN `2024-01-01` into `time.Time`, which the reference's
      `.(string)` rejects; the `yaml` package gives a string and the source's quoting is not
      kept. Where reading a value as a string could ADD a warning (an endpoint), a
      timestamp-shaped string is skipped, so a QUOTED one warns in the reference and not here.
    - **JS only, looser: a `!!binary` value** is a string to yaml.v3 and bytes here.
    - **Not ported, verdict-neutral:** Go validates a bracketed IPv6 host with
      `netip.ParseAddr`; a bracketed host is never a default's host either way.

---

## Unknown keys and value kinds

The reference's save door decodes a flow with yaml.v3 `KnownFields(true)`. That refuses
a key the containing Go struct does not declare, **at every depth**, and a value whose
KIND does not decode into the field (a scalar where a struct, map or list is required,
or a mapping or list where a scalar is). `validators/unknownKeys.ts` reproduces both.

**The key sets are derived, not hand-listed.** `knownKeys` in the spec is generated by
reflection over the reference's `Flow` type, applying yaml.v3's own field rules:

- a field's key is its `yaml:` tag name, or the lowercased field name when untagged;
  `yaml:"-"` and unexported fields are skipped;
- an `,inline` struct's keys merge into the parent (this is why `currency` and
  `max_duration` are flow-root keys); an `,inline` map would make the type open (none
  does today);
- a pointer is followed; a slice becomes `list<…>`; a map becomes `map<…>` with
  author-chosen keys; an interface is `any`;
- a type with its own `UnmarshalYAML` is `any`, because yaml.v3 does not propagate
  `KnownFields` into `Node.Decode`. The one such type is a pre/post-processing entry,
  whose shape stays out of scope (divergence #11).

**How it was checked.** For each of the 35 struct types, a document placing an unknown
key at that type's position must be refused as an unknown key; for each of its keys, a
value of each wrong kind must fail to decode and a null must decode; for each `any`
position, a mapping, a list and a scalar must all decode. 771 checks, run against the
reference's strict parser, all as expected, and a mutated inventory (a key removed, a
kind changed) fails them. On the 216 bundled flows the rule fires zero times.

**What is judged.** Keys and kinds only. Whether a scalar fits its field (a number in an
integer field, `yes` in a boolean) is left to the rules that already own those fields
(divergence #8). A YAML null is the zero value of any type and is never reported. A key
the reference deleted from the grammar is named as retired wherever it appears; at the
locations `retiredKeys.ts` covers, that rule's specific advice is reported instead, and a
location is never reported twice.

**Regenerating it.** On a grammar change, re-run the derivation above against the new
reference types (a short Go program: reflect over `Flow`, apply the rules above, print
each struct type's key → shape map, sorted) and replace `knownKeys` in the spec. Then
re-run the check above and the bundled-corpus comparison. The derivation program is
not shipped here, because it links the reference implementation.

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
   values and bump `specVersion` to the new AIgentFlow version. A new or renamed field
   in any flow type also means regenerating `knownKeys` (see
   [Unknown keys and value kinds](#unknown-keys-and-value-kinds)); otherwise the new key
   is refused as unknown.
2. Port the rule into the matching `validators/*.ts` module (or add a new module).
3. Add a row to the [rule map](#rule-map) above and, if it diverges, an entry under
   [Intentional divergences](#intentional-divergences).
4. Add a conformance fixture under `test/conformance/fixtures/` plus an entry in
   `test/conformance/conformance.test.ts`, and a focused unit test.
5. `npm run typecheck && npm run lint && npm test && npm run build` — all green.
6. Bump the package version and update `SPEC_VERSION` in the README.

> The `aigentflow` repository's `CLAUDE.md` carries a reciprocal note pointing back here,
> so a flow-YAML change in either repo surfaces the obligation to update the other.
