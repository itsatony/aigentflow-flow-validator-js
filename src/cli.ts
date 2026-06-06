// Command-line entry point: `aigentflow-validate <file...|->`.
//
// This is the only module permitted to use Node builtins; the library entry
// (`.`) stays browser-safe. Exit codes: 0 = clean, 1 = validation failed,
// 2 = usage error.

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { validateFlow, SPEC_VERSION } from './index.js';
import type { ValidationIssue, ValidationResult } from './types.js';

interface CliOptions {
  json: boolean;
  strict: boolean;
  strictRegistries: boolean;
  files: string[];
}

const USAGE = `aigentflow-validate — static validator for AIgentFlow flow YAML

Usage:
  aigentflow-validate [options] <file...>
  aigentflow-validate [options] -          # read YAML from stdin

Options:
  --json                 Output machine-readable JSON (a single result, or an
                         array when validating multiple files).
  --strict               Treat warnings as failures (non-zero exit).
  --strict-registries    Error (not warn) on unknown orchestrator tools and
                         unknown template functions.
  -h, --help             Show this help.
  -v, --version          Show the validator version and tracked AIgentFlow schema.

Exit codes: 0 = valid, 1 = validation failed, 2 = usage error.`;

function parseArgs(argv: string[]): CliOptions | { error: string } {
  const opts: CliOptions = { json: false, strict: false, strictRegistries: false, files: [] };
  for (const arg of argv) {
    switch (arg) {
      case '--json':
        opts.json = true;
        break;
      case '--strict':
        opts.strict = true;
        break;
      case '--strict-registries':
        opts.strictRegistries = true;
        break;
      default:
        if (arg.startsWith('--') || (arg.startsWith('-') && arg !== '-')) {
          return { error: `Unknown option: ${arg}` };
        }
        opts.files.push(arg);
    }
  }
  if (opts.files.length === 0) {
    return { error: 'No input files given.' };
  }
  return opts;
}

const isTTY = process.stdout.isTTY === true;
function color(code: string, text: string): string {
  return isTTY ? `[${code}m${text}[0m` : text;
}

function formatIssue(issue: ValidationIssue): string {
  const loc = issue.line ? ` (line ${issue.line}${issue.column ? `:${issue.column}` : ''})` : '';
  const tag =
    issue.severity === 'error'
      ? color('31', 'error')
      : issue.severity === 'warning'
        ? color('33', 'warn')
        : color('36', 'info');
  const field = issue.field ? color('2', ` [${issue.field}]`) : '';
  const lines = [`  ${tag} ${issue.code}${field}${loc}`, `      ${issue.message}`];
  if (issue.suggestion) lines.push(`      ${color('2', `↳ ${issue.suggestion}`)}`);
  return lines.join('\n');
}

function printHuman(label: string, result: ValidationResult): void {
  const head = result.valid ? color('32', `✓ ${label}: valid`) : color('31', `✗ ${label}: invalid`);
  const s = result.summary;
  process.stdout.write(
    `${head} — ${s.errorCount} error(s), ${s.warningCount} warning(s), ${s.totalSteps} step(s)\n`,
  );
  for (const e of result.errors) process.stdout.write(`${formatIssue(e)}\n`);
  for (const w of result.warnings) process.stdout.write(`${formatIssue(w)}\n`);
}

function readSource(file: string): string {
  if (file === '-') return readFileSync(0, 'utf8');
  return readFileSync(file, 'utf8');
}

function main(): number {
  const argv = process.argv.slice(2);

  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (argv.includes('-v') || argv.includes('--version')) {
    process.stdout.write(
      `aigentflow-flow-validator (tracks AIgentFlow flow schema v${SPEC_VERSION})\n`,
    );
    return 0;
  }

  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    process.stderr.write(`${parsed.error}\n\n${USAGE}\n`);
    return 2;
  }

  const opts = { strictRegistries: parsed.strictRegistries };
  const results: { file: string; result: ValidationResult }[] = [];

  for (const file of parsed.files) {
    let source: string;
    try {
      source = readSource(file);
    } catch (e) {
      process.stderr.write(
        `Cannot read ${file === '-' ? 'stdin' : file}: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      return 2;
    }
    results.push({ file: file === '-' ? '<stdin>' : file, result: validateFlow(source, opts) });
  }

  if (parsed.json) {
    const payload =
      results.length === 1
        ? results[0]!.result
        : results.map((r) => ({ file: r.file, ...r.result }));
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    results.forEach((r, i) => {
      if (i > 0) process.stdout.write('\n');
      printHuman(r.file, r.result);
    });
  }

  const failed = results.some(
    (r) => !r.result.valid || (parsed.strict && r.result.warnings.length > 0),
  );
  return failed ? 1 : 0;
}

process.exit(main());
