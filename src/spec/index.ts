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

/** Recognised Go template function names (Go builtins + AIgentFlow registry). */
export const TEMPLATE_FUNCTIONS: ReadonlySet<string> = new Set(spec.templateFunctions);
