import { Command } from 'commander';

import { createQueryTarget } from '../../core/logic/query-targets.js';
import type { CommitValidationResult, FormattableValidationResult, ValidationIssue } from '../../core/types/output.js';
import type { EngineInfra } from '../../services/engine-bootstrapper.js';
import { findAtoms } from '../../shell/orchestrators/discovery.js';
import { validateCommits } from '../../shell/orchestrators/validation.js';

interface ValidateCommandOptions {
  readonly since?: string;
  readonly last?: number;
  readonly strict?: boolean;
}

/**
 * Register the validate [range] command.
 * Validates commits for protocol compliance.
 */
export function registerValidateCommand(
  program: Command,
  infra: EngineInfra,
): void {
  const { protocolRoot, cwd } = infra;
  program
    .command('validate [range]')
    .description('Validate commits for protocol compliance')
    .option('--since <ref>', 'Validate all commits since ref (e.g., main)')
    .option('--last <n>', 'Validate the last N commits', parseInt)
    .option('--strict', 'Treat warnings as errors')
    .action(async (range: string | undefined, options: ValidateCommandOptions) => {
      const { getFormatter } = infra;

      const target = createQueryTarget(range, { cwd, protocolRoot, isScoped: false });

      const atoms = await findAtoms(infra, target, {
        since: options.since,
        maxCommits: options.last,
        includeAllCommits: true,
      });

      // Validate all commits using the shell orchestrator
      let results: readonly CommitValidationResult[] = await validateCommits(atoms, infra);

      // In strict mode, upgrade each warning issue to an error
      if (options.strict) {
        results = results.map((result): CommitValidationResult => {
          const upgradedIssues: readonly ValidationIssue[] = result.issues.map(
            (issue): ValidationIssue =>
              issue.severity === 'warning'
                ? { severity: 'error', rule: issue.rule, message: issue.message }
                : issue,
          );
          const hasErrors = upgradedIssues.some((i) => i.severity === 'error');
          return {
            commit: result.commit,
            identities: result.identities,
            valid: !hasErrors,
            issues: upgradedIssues,
          };
        });
      }

      // Compute summary from (possibly upgraded) results
      let totalErrors = 0;
      let totalWarnings = 0;

      for (const result of results) {
        for (const issue of result.issues) {
          if (issue.severity === 'error') {
            totalErrors++;
          } else {
            totalWarnings++;
          }
        }
      }

      const allValid = totalErrors === 0;

      const validationResult: FormattableValidationResult = {
        valid: allValid,
        summary: {
          errors: totalErrors,
          warnings: totalWarnings,
          commitsChecked: results.length,
        },
        results,
      };

      const formatter = getFormatter();
      logger.result(formatter.formatValidationResult(validationResult));

      // Exit with appropriate code
      if (totalErrors > 0) {
        process.exitCode = 1;
      } else if (totalWarnings > 0) {
        process.exitCode = 2;
      }
    });
}
