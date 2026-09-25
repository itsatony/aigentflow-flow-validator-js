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

/** Non-step `next` markers that are always valid targets. */
export const NEXT_MARKERS: ReadonlySet<string> = new Set(spec.nextMarkers);

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
