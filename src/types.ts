// Public types for the AIgentFlow flow validator.
//
// The result types mirror the Go reference implementation
// (`aigentflow/aigentflow.validation.go` — `ValidationResult`,
// `ValidationError`, `ValidationWarning`, `ValidationSummary`) so that a
// consumer can switch between the two and read the same shape. Error `code`
// strings are the cross-implementation parity contract; human-readable
// `message` wording may differ.

/** Severity of a validation issue. `info` is reserved for future lints. */
export type Severity = 'error' | 'warning' | 'info';

/**
 * A single validation finding. The same shape is used for errors and
 * warnings; warnings simply carry `severity: 'warning'` and never set
 * {@link ValidationResult.valid} to false.
 */
export interface ValidationIssue {
  /** Dotted field path, e.g. `steps.fetch.query.url`. */
  field: string;
  /** Human-readable description of the problem. */
  message: string;
  /** Stable, machine-readable code (parity contract). */
  code: string;
  /** Severity. */
  severity: Severity;
  /** Step ID when the issue is step-specific. */
  stepId?: string;
  /** 1-based line in the source YAML, when known. */
  line?: number;
  /** 1-based column in the source YAML, when known. */
  column?: number;
  /** Extra context (e.g. the available step names). */
  context?: string;
  /** Suggested fix. */
  suggestion?: string;
}

/** Roll-up statistics for a validation run. */
export interface ValidationSummary {
  totalSteps: number;
  validSteps: number;
  errorCount: number;
  warningCount: number;
  templatesFound: number;
  templatesValid: number;
}

/** The complete result of validating one flow. */
export interface ValidationResult {
  /** True when there are zero `error`-severity issues. */
  valid: boolean;
  /** Error-severity issues. A non-empty list means `valid` is false. */
  errors: ValidationIssue[];
  /** Warning-severity issues. Never affect `valid`. */
  warnings: ValidationIssue[];
  /** Roll-up statistics. */
  summary: ValidationSummary;
}

/** Options accepted by {@link validateFlow} and {@link validateFlowObject}. */
export interface ValidateOptions {
  /**
   * When true, an unrecognised orchestrator tool name and an unknown template
   * function are reported as `error` instead of `warning`. Off by default
   * because the vendored allow-lists can lag the live AIgentFlow registries,
   * and a false-positive error is worse than a missed lint. See PARITY.md.
   */
  strictRegistries?: boolean;
}

// ---------------------------------------------------------------------------
// Flow document shape.
//
// User YAML is arbitrary, so validators operate defensively on `unknown` and
// these interfaces are advisory documentation rather than a parse-time
// guarantee. Field names match the Go YAML tags.
// ---------------------------------------------------------------------------

export interface PropertyDefinition {
  type?: string;
  description?: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
  format?: string;
  properties?: Record<string, PropertyDefinition>;
  validation?: string;
  items?: PropertyDefinition;
  min_items?: number;
  max_items?: number;
  unique_items?: boolean;
}

export type QueryDefinition = PropertyDefinition;

export interface ErrorStrategyDefinition {
  action?: string;
  max_retries?: number;
  retry_delay?: string;
  goto_step?: string;
  exponential_backoff?: boolean;
  max_delay?: string;
  backoff_multiplier?: number;
  jitter?: boolean;
  retry_on?: string[];
}

export interface NextCondition {
  if?: string;
  goto_step?: string;
}

export interface ParallelDefinition {
  rendezvous?: string;
  steps?: string[];
  resolution?: string;
}

export interface NextLogicDefinition {
  default?: string;
  conditions?: NextCondition[];
  parallel?: ParallelDefinition;
}

export interface ThrottleDefinition {
  delay?: string;
  batch_size?: number;
  batch_delay?: string;
}

export interface ForEachDefinition {
  items?: string;
  as?: string;
  max_parallel?: number;
  resolution?: string;
  throttle?: ThrottleDefinition;
}

export interface LoopSubStep {
  id?: string;
  executor?: string;
  credential?: string;
  credentials?: Record<string, CredentialBinding | null>;
  [key: string]: unknown;
}

export interface LoopDefinition {
  while?: string;
  max_iterations?: number;
  steps?: LoopSubStep[];
}

export interface CredentialBinding {
  source?: string;
  inject_as?: string;
}

export interface ResponseExpectationField {
  type?: string;
  required?: boolean | string;
  items?: PropertyDefinition;
}

export interface StepDefinition {
  executor?: string;
  query?: Record<string, unknown>;
  pre_processing?: unknown[];
  post_processing?: unknown[];
  response_expectation?: Record<string, ResponseExpectationField>;
  next?: NextLogicDefinition;
  error_strategy?: ErrorStrategyDefinition;
  for_each?: ForEachDefinition;
  loop?: LoopDefinition;
  credential?: string;
  credentials?: Record<string, CredentialBinding | null>;
  [key: string]: unknown;
}

export interface ExpressionFunctionDefinition {
  package?: string;
  function?: string;
}

export interface VisibleWhenPredicate {
  field?: string;
  equals?: unknown;
  in?: unknown[];
}

export interface InputSchemaField {
  name?: string;
  type?: string;
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  min?: number;
  max?: number;
  min_length?: number;
  max_length?: number;
  min_items?: number;
  max_items?: number;
  pattern?: string;
  accept?: string[];
  max_size?: number;
  visible_when?: VisibleWhenPredicate;
}

export interface InputSchema {
  version?: number;
  fields?: InputSchemaField[];
}

export interface OrchestratorTrigger {
  type?: string;
  interval?: string;
}

export interface OrchestratorDefinition {
  exons?: string;
  agentic?: boolean;
  triggers?: OrchestratorTrigger[];
  tools?: string[];
  max_turns?: number;
}

export interface Flow {
  aigentflow_version?: string;
  name?: string;
  version?: string;
  description?: string;
  handle?: string;
  visibility?: string;
  start?: string;
  steps?: Record<string, StepDefinition>;
  query?: Record<string, QueryDefinition>;
  output?: string[];
  error_strategy?: ErrorStrategyDefinition;
  expression_functions?: ExpressionFunctionDefinition[];
  constraints?: Record<string, unknown>;
  // Constraints are embedded inline in the Go struct, so they may also appear
  // at the top level.
  currency?: string;
  budget?: number;
  max_duration?: string;
  max_retries?: number;
  orchestrator?: OrchestratorDefinition;
  campaign?: Record<string, unknown>;
  checkpoint?: Record<string, unknown>;
  input_schema?: InputSchema;
  classification?: Record<string, unknown>;
  is_template?: boolean;
  template?: Record<string, unknown> | null;
  [key: string]: unknown;
}
