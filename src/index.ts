// Public API for the AIgentFlow flow validator.
//
// Static, offline validation of flow YAML. Reproduces the *static* verdicts of
// the AIgentFlow Go reference validator (Validator.ValidateFlowWithDetails +
// FlowParser.ValidateFlow). Runtime concerns — credentials, the compliance
// catalog, and template field resolution — are out of scope. See PARITY.md.

import type { Flow, ValidateOptions, ValidationIssue, ValidationResult } from './types.js';
import { parseFlow, type ParseOutput } from './parse.js';
import { Issues } from './validators/util.js';
import { validateBasicStructure } from './validators/basicStructure.js';
import { validateExecutors } from './validators/executors.js';
import { validateQuerySchema } from './validators/querySchema.js';
import { validateResponseExpectations } from './validators/responseExpectation.js';
import { validateErrorStrategies } from './validators/errorStrategy.js';
import { validateConnectivity } from './validators/connectivity.js';
import { validateNextLogic } from './validators/nextLogic.js';
import { validateExpressionFunctions } from './validators/expressionFunctions.js';
import { validateLoopForEachThrottle } from './validators/loopForEachThrottle.js';
import { validateOrchestratorCampaign } from './validators/orchestratorCampaign.js';
import { validateCredentialBindings } from './validators/credentialBindings.js';
import { validateInputSchema } from './validators/inputSchema.js';
import { validateTemplates } from './validators/templates.js';

export { SPEC_VERSION, INPUT_SCHEMA_VERSION } from './spec/index.js';
export { parseFlow } from './parse.js';
export type { ParseOutput } from './parse.js';
export type {
  Flow,
  ValidateOptions,
  ValidationIssue,
  ValidationResult,
  ValidationSummary,
  Severity,
} from './types.js';

function countStepsWithErrors(errors: ValidationIssue[]): number {
  const ids = new Set<string>();
  for (const e of errors) {
    if (e.stepId) ids.add(e.stepId);
  }
  return ids.size;
}

/**
 * Validate an already-parsed flow object. Use this when you have a plain
 * object (e.g. from your own YAML/JSON loader); use {@link validateFlow} to
 * parse YAML text and validate in one step.
 */
export function validateFlowObject(flow: unknown, opts: ValidateOptions = {}): ValidationResult {
  const issues = new Issues();

  if (flow === null || typeof flow !== 'object' || Array.isArray(flow)) {
    issues.error({
      field: '',
      message: 'Flow must be a mapping (object) at the top level',
      code: 'invalid_flow_root',
    });
    return {
      valid: false,
      errors: issues.errors,
      warnings: issues.warnings,
      summary: {
        totalSteps: 0,
        validSteps: 0,
        errorCount: issues.errors.length,
        warningCount: issues.warnings.length,
        templatesFound: 0,
        templatesValid: 0,
      },
    };
  }

  const f = flow as Flow;

  validateBasicStructure(f, issues);
  validateExecutors(f, issues);
  validateQuerySchema(f, issues);
  validateResponseExpectations(f, issues);
  validateErrorStrategies(f, issues);
  validateConnectivity(f, issues);
  validateNextLogic(f, issues);
  validateExpressionFunctions(f, issues);
  validateLoopForEachThrottle(f, issues);
  validateOrchestratorCampaign(f, issues, opts);
  validateCredentialBindings(f, issues);
  validateInputSchema(f, issues);
  const templateStats = validateTemplates(f, issues, opts);

  const totalSteps =
    f.steps && typeof f.steps === 'object' && !Array.isArray(f.steps)
      ? Object.keys(f.steps).length
      : 0;
  const errorCount = issues.errors.length;

  return {
    valid: errorCount === 0,
    errors: issues.errors,
    warnings: issues.warnings,
    summary: {
      totalSteps,
      validSteps: Math.max(0, totalSteps - countStepsWithErrors(issues.errors)),
      errorCount,
      warningCount: issues.warnings.length,
      templatesFound: templateStats.found,
      templatesValid: Math.max(0, templateStats.found - templateStats.syntaxErrors),
    },
  };
}

/**
 * Parse flow YAML text and validate it. Parse errors (syntax, duplicate keys)
 * are returned as `error`-severity issues; on a parse failure the structural
 * validators are skipped because there is no usable document.
 */
export function validateFlow(yamlText: string, opts: ValidateOptions = {}): ValidationResult {
  const parsed: ParseOutput = parseFlow(yamlText);

  if (parsed.parseErrors.length > 0 || parsed.flow === undefined) {
    return {
      valid: false,
      errors: parsed.parseErrors,
      warnings: parsed.parseWarnings,
      summary: {
        totalSteps: 0,
        validSteps: 0,
        errorCount: parsed.parseErrors.length,
        warningCount: parsed.parseWarnings.length,
        templatesFound: 0,
        templatesValid: 0,
      },
    };
  }

  const result = validateFlowObject(parsed.flow, opts);
  // Surface any non-fatal YAML warnings alongside the validation warnings.
  if (parsed.parseWarnings.length > 0) {
    result.warnings.unshift(...parsed.parseWarnings);
    result.summary.warningCount = result.warnings.length;
  }
  return result;
}
