// Typed accessor over the vendored enum spec. The JSON is the single source
// of the protocol/type names; this module exposes it as frozen Sets/values for
// fast, immutable lookups by the validators.

// The JSON is bundled (inlined) by tsup/esbuild at build time, so there is no
// runtime JSON module load to worry about across ESM/CJS targets.
import spec from './aigentflow-spec.json';

/** The AIgentFlow version whose flow schema this validator tracks. */
export const SPEC_VERSION: string = spec.specVersion;

/** Current supported `input_schema.version`. */
export const INPUT_SCHEMA_VERSION: number = spec.inputSchemaVersion;

/** Known executor URI schemes. Unknown schemes are warned, not rejected. */
export const EXECUTOR_SCHEMES: ReadonlySet<string> = new Set(spec.executorSchemes);

/** Valid data types for query params, array items, and response expectations. */
export const DATA_TYPES: ReadonlySet<string> = new Set(spec.dataTypes);

/** Valid `error_strategy.action` values. */
export const ERROR_STRATEGY_ACTIONS: ReadonlySet<string> = new Set(spec.errorStrategyActions);

/** Valid `error_strategy.retry_on` error categories. */
export const RETRY_ON_CATEGORIES: ReadonlySet<string> = new Set(spec.retryOnCategories);

/**
 * `next` targets the reference's SAVE door accepts without a step of that name:
 * `null` and `orchestrator`. `end` is not one of them — `validateNextLogic`
 * (parser.go) looks `end` up as a step and refuses the flow when none exists.
 */
export const NEXT_MARKERS: ReadonlySet<string> = new Set(spec.nextMarkers);

/**
 * Targets the reachability and cycle walks treat as "control leaves the graph".
 *
 * Since AIgentFlow v2.760.0 this holds the same values as {@link NEXT_MARKERS}:
 * no reference walk treats `end` as a terminal any more, so a real step named
 * `end` is reachable and a cycle through it is a cycle. Until then this set was
 * WIDER (it carried `end`), and a step named `end` that only `end` routed to was
 * reported `unreachable_step`. The two stay separate spec keys so a future
 * split is a one-value change.
 */
export const REACHABILITY_TERMINAL_MARKERS: ReadonlySet<string> = new Set(
  spec.reachabilityTerminalMarkers,
);

/** Valid `next.parallel.resolution` values. */
export const PARALLEL_RESOLUTIONS: ReadonlySet<string> = new Set(spec.parallelResolutions);

/** Valid `for_each.resolution` values. */
export const FOR_EACH_RESOLUTIONS: ReadonlySet<string> = new Set(spec.forEachResolutions);

/** Hard cap for `loop.max_iterations`. */
export const LOOP_MAX_ITERATIONS_LIMIT: number = spec.loopMaxIterationsLimit;

/**
 * The ONE executor-URL shape, mirrored verbatim from `URL_PATTERN_REGEX` in
 * `aigentflow/aigentflow.domain.executorregistry.go`.
 *
 * AIgentFlow has exactly one executor-URL parser (`ParseExecutorURLString`), and
 * since v2.598.0 (DC-FORGE-30) its own static validation applies it at authoring
 * time — so `openai:///gpt-4` is refused at save instead of failing at dispatch.
 * Note how much stricter it is than a generic URI: the authority segment is
 * required and non-empty, and neither authority nor path may contain a dot.
 */
export const EXECUTOR_URL_PATTERN: RegExp = new RegExp(spec.executorUrlPattern);

/** Opening delimiter of a Go-template action; a URL containing one is rendered before dispatch. */
export const TEMPLATE_ACTION_OPEN: string = spec.templateActionOpen;

/** Credential binding source prefix (`stored/{provider}/{name}`). */
export const CREDENTIAL_REFERENCE_PREFIX: string = spec.credentialReferencePrefix;

/** input_schema constants and limits. */
export const INPUT_SCHEMA = {
  types: new Set(spec.inputSchema.types) as ReadonlySet<string>,
  stringTypes: new Set(spec.inputSchema.stringTypes) as ReadonlySet<string>,
  parametricTypes: new Set(spec.inputSchema.parametricTypes) as ReadonlySet<string>,
  fieldNamePattern: new RegExp(spec.inputSchema.fieldNamePattern),
  datePattern: new RegExp(spec.inputSchema.datePattern),
  maxPatternLength: spec.inputSchema.maxPatternLength,
  maxConstraintValue: spec.inputSchema.maxConstraintValue,
  maxInputKeyCount: spec.inputSchema.maxInputKeyCount,
  maxStringInputLength: spec.inputSchema.maxStringInputLength,
} as const;

/** Valid orchestrator trigger types. */
export const ORCHESTRATOR_TRIGGERS: ReadonlySet<string> = new Set(spec.orchestrator.triggers);

/** Recognised orchestrator tool names (vendored allow-list, may lag). */
export const ORCHESTRATOR_TOOLS: ReadonlySet<string> = new Set(spec.orchestrator.tools);

/** Orchestrator termination-authority modes (DC-COND-1). Default = monitor. */
export const ORCHESTRATOR_MODES: ReadonlySet<string> = new Set(spec.orchestrator.modes);

/** Recognised Go template function names (Go builtins + AIgentFlow registry). */
export const TEMPLATE_FUNCTIONS: ReadonlySet<string> = new Set(spec.templateFunctions);

/** Canonical `eval://judge` URL invoked by the quality_gate machinery. */
export const EVAL_JUDGE_URL: string = spec.evalJudgeUrl;

/** `quality_gate:` step-block constants and limits (DC-CP-8). */
export const QUALITY_GATE = {
  /** Accepted `on_fail` actions. */
  onFailActions: new Set(spec.qualityGate.onFailActions) as ReadonlySet<string>,
  /**
   * `on_fail` values that exist in the Go enum but are currently
   * validation-REJECTED (e.g. `human`, pending the human-task inbox).
   */
  onFailRejected: new Set(spec.qualityGate.onFailRejected) as ReadonlySet<string>,
  thresholdMin: spec.qualityGate.thresholdMin,
  thresholdMax: spec.qualityGate.thresholdMax,
} as const;

/**
 * The fixed `expression_functions:` catalog (DC-FORGE-72).
 *
 * The catalog is compiled into the AIgentFlow binary — nothing is loaded at run
 * time, ever — so it is an enumerable set, and a `function:` outside it is an
 * error rather than a lag-prone allow-list warning (contrast divergence #4).
 * Every entry carries {@link EXPRESSION_FUNCTION_NAME_PREFIX} so a catalog entry
 * can never shadow a standard template function such as `index` or `default`.
 */
export const EXPRESSION_FUNCTION_CATALOG: ReadonlySet<string> = new Set(
  spec.expressionFunctions.catalog,
);

/** Mandatory namespace prefix carried by every catalog entry. */
export const EXPRESSION_FUNCTION_NAME_PREFIX: string = spec.expressionFunctions.namePrefix;

/**
 * Pre/post-processing operation dispatch set and per-operation config keys.
 *
 * Two things are modelled here and neither may be flattened into the other:
 *
 * - **Scope.** The standard handler (every top-level step's pre/post-processing)
 *   dispatches {@link PROCESSING_OPERATIONS.standardTypes}. A loop sub-step's
 *   post-processing handles `loop.set` / `loop.break` itself before delegating,
 *   so those two are legal only there. Keeping them apart is the point: a name
 *   in the wrong half is exactly the mistake a merged set cannot see.
 * - **Key sets are PER OPERATION, never a union.** `asset_id` is read by
 *   `binary.get`/`binary.update`/`binary.delete` and is NOT read by
 *   `binary.transform`, which reads `source_asset_id`. A union-based check would
 *   pass the wrong-half key, which is the defect class this rule exists for.
 *
 * `openKeyTypes` are the operations whose config keys are chosen by the AUTHOR
 * (`data.set` writes every key into `.data`, `output.set` into `.output`,
 * `conversation.append` treats every key as a conversation id, `loop.set` as a
 * loop variable), so "unknown key" is not a notion that applies to them at all.
 *
 * Scope note: only TOP-LEVEL config keys are modelled. Sub-keys of `metadata:`
 * (the asset store's vocabulary) and `parameters:` (the transformer's) are not.
 */
export const PROCESSING_OPERATIONS = {
  /** The optional guard key, a sibling of the operation key rather than a config key. */
  guardKey: spec.processingOperations.guardKey,
  /** Operation types the standard (top-level step) handler dispatches. */
  standardTypes: new Set(spec.processingOperations.standardTypes) as ReadonlySet<string>,
  /** Operation types dispatchable ONLY in a loop sub-step's post_processing. */
  loopSubStepTypes: new Set(spec.processingOperations.loopSubStepTypes) as ReadonlySet<string>,
  /** Operations whose config keys are author-chosen; they have no unknown-key notion. */
  openKeyTypes: new Set(spec.processingOperations.openKeyTypes) as ReadonlySet<string>,
  /** Per-operation top-level config keys, for the operations with a CLOSED key set. */
  closedConfigKeys: spec.processingOperations.closedConfigKeys as Readonly<
    Record<string, readonly string[]>
  >,
} as const;

/**
 * The top-level config keys an operation reads, and whether that set is CLOSED.
 *
 * A `false` second element means there is no basis for a verdict about a key —
 * either the operation chooses its own key names, or the type is not
 * dispatchable at all. Callers must check the flag rather than the array length.
 */
export function processingOperationConfigKeys(operationType: string): [readonly string[], boolean] {
  if (PROCESSING_OPERATIONS.openKeyTypes.has(operationType)) return [[], false];
  const keys = PROCESSING_OPERATIONS.closedConfigKeys[operationType];
  return keys === undefined ? [[], false] : [keys, true];
}

/**
 * The key set the reference's strict save parser enforces at every level of a
 * flow document, derived from its own types (see the `$comment` in the JSON).
 * `types[T]` maps each key a struct type declares to the SHAPE of its value.
 */
export const KNOWN_KEYS = spec.knownKeys as {
  readonly root: string;
  readonly types: Readonly<Record<string, Readonly<Record<string, string>>>>;
};

/**
 * Which orchestrator tools the inline `.exons` definition's `tools.allow` may
 * withhold (AIgentFlow v2.760.0, `orchestrator_tool_withheld`). A tool is offered
 * only if it passes BOTH `orchestrator.tools` (empty = every tool) AND
 * `tools.allow` (absent = no narrowing). The lifecycle tools, and the signal
 * tools while `enable_signals` is on (the default), are exempt from
 * `tools.allow`.
 */
export const ORCHESTRATOR_TOOL_ALLOW = {
  warningField: spec.orchestratorToolAllow.warningField,
  askHumanTool: spec.orchestratorToolAllow.askHumanTool,
  enableSignalsDefault: spec.orchestratorToolAllow.enableSignalsDefault,
  lifecycleTools: spec.orchestratorToolAllow.lifecycleTools as readonly string[],
  signalTools: spec.orchestratorToolAllow.signalTools as readonly string[],
  campaignTools: spec.orchestratorToolAllow.campaignTools as readonly string[],
} as const;

/** Where an inline `.exons` document arrives at the save door. */
export const EXONS = {
  /** A step's document is judged only on an executor with this prefix. */
  executorPrefix: spec.exons.executorPrefix,
  /** The step `query` parameter that carries the document. */
  documentParam: spec.exons.documentParam,
  /** The YAML frontmatter delimiter line. */
  frontmatterDelimiter: spec.exons.frontmatterDelimiter,
} as const;

/**
 * `executor_config` may expand only the environment variables of the key it is
 * written under (AIgentFlow v2.597.0, `executor_config_env_scope`). `scopes` is
 * the reference's own scope function evaluated for every key that has one; a
 * key absent from it has an EMPTY scope and refuses every reference.
 */
export const EXECUTOR_CONFIG_ENV_SCOPES = {
  referencePrefix: spec.executorConfigEnvScopes.referencePrefix,
  referenceSuffix: spec.executorConfigEnvScopes.referenceSuffix,
  fields: spec.executorConfigEnvScopes.fields as readonly string[],
  extraKey: spec.executorConfigEnvScopes.extraKey,
  scopes: spec.executorConfigEnvScopes.scopes as Readonly<Record<string, readonly string[]>>,
} as const;

/**
 * Executor parameters only the server's credential resolver may set (AIgentFlow
 * CFX-05, `server_owned_query_key`). A step's or loop sub-step's `query:` that
 * declares one is refused. `keys` is matched exactly and case-sensitively; the
 * two formats are the reference's field paths, `%s` filled in order.
 */
export const SERVER_OWNED_QUERY_KEYS = {
  keys: spec.serverOwnedQueryKeys.keys as readonly string[],
  stepFieldFormat: spec.serverOwnedQueryKeys.stepFieldFormat,
  loopStepFieldFormat: spec.serverOwnedQueryKeys.loopStepFieldFormat,
} as const;

/** One row of the reference's per-protocol credential/endpoint family table. */
export interface CredentialEndpointFamily {
  readonly protocol: string;
  readonly configKeys: readonly string[];
  readonly secretParams: readonly string[];
  readonly endpointParams: readonly string[];
  readonly defaultEndpoints: readonly string[];
  readonly configApiKeyParam: string;
  readonly configBaseUrlParam: string;
  readonly implicitServerCredential: boolean;
  readonly expandsServerEnvReferences: boolean;
  /** The family's server-variable set, evaluated from the reference's scope tables. */
  readonly serverEnv: readonly string[];
  /** A family judged like ai:// (nexus): an endpoint with no key of the flow's own. */
  readonly storedKeyShape?: {
    readonly ownKeyParams: readonly string[];
    readonly ownCredentialsMapParam: string;
    readonly provider: string;
  };
}

/**
 * The data of `credential_endpoint_unpaired` (AIgentFlow DC-FORGE-231 and
 * DC-FORGE-233): the ai:// provider rule's names and sets, the per-protocol
 * family table, the default ports, and the reference's field formats (`%s`
 * filled in order). A new family is a change to this data only.
 */
export const CREDENTIAL_ENDPOINT_PAIRING = {
  stepFieldFormat: spec.credentialEndpointPairing.stepFieldFormat,
  loopStepFieldFormat: spec.credentialEndpointPairing.loopStepFieldFormat,
  executorConfigBaseUrlFieldFormat: spec.credentialEndpointPairing.executorConfigBaseUrlFieldFormat,
  executorConfigKeyFieldFormat: spec.credentialEndpointPairing.executorConfigKeyFieldFormat,
  executorConfigExtraFieldFormat: spec.credentialEndpointPairing.executorConfigExtraFieldFormat,
  executorConfigApiKeyField: spec.credentialEndpointPairing.executorConfigApiKeyField,
  executorConfigBaseUrlField: spec.credentialEndpointPairing.executorConfigBaseUrlField,
  protocolSeparator: spec.credentialEndpointPairing.protocolSeparator,
  defaultPorts: spec.credentialEndpointPairing.defaultPorts as Readonly<Record<string, string>>,
  ai: {
    protocol: spec.credentialEndpointPairing.ai.protocol,
    genericKeyParam: spec.credentialEndpointPairing.ai.genericKeyParam,
    providerKeyParamSuffix: spec.credentialEndpointPairing.ai.providerKeyParamSuffix,
    providerBaseUrlParamSuffix: spec.credentialEndpointPairing.ai.providerBaseUrlParamSuffix,
    keylessProviders: spec.credentialEndpointPairing.ai.keylessProviders as readonly string[],
    executorConfigProviders: spec.credentialEndpointPairing.ai
      .executorConfigProviders as readonly string[],
  },
  familyKeySeparator: spec.credentialEndpointPairing.familyKeySeparator,
  protocolAliases: spec.credentialEndpointPairing.protocolAliases as Readonly<
    Record<string, string>
  >,
  families: spec.credentialEndpointPairing.families as Readonly<
    Record<string, CredentialEndpointFamily>
  >,
} as const;
