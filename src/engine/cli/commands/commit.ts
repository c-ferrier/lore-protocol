import { Command } from 'commander';

// Pure Logic Modules
import { formatCommit, validateFormatting } from '../../core/logic/commit-formatting.js';
import { getAuthorizedKeys } from '../../core/logic/protocols.js';
import { slugify } from '../../core/logic/string.js';
import type { AtomId } from '../../core/types/domain.js';
import type { IPrompt } from '../../interfaces/prompt.js';
import type { EngineInfra } from '../../services/engine-bootstrapper.js';
import { readHeadIdentities } from '../../shell/git/head-id-reader.js';
import { ProtocolError } from '../../util/errors.js';
import { resolveCommitInput } from '../readers/commit-input-resolver.js';
import { mergeOptions } from './helpers/merge-options.js';

/**
 * CLI Options for the commit command.

 */
interface CommitCommandOptions {
  readonly subject?: string;
  readonly body?: string;
  readonly file?: string;
  readonly interactive?: boolean;
  readonly amend?: boolean;
  readonly edit?: boolean;
  readonly trailer?: string[];
  /** Dynamic core flags from definitions (e.g. confidence, scope-risk) */
  readonly [key: string]: unknown;
}

/**
 * Register the commit command.
 * Orchestrates the creation of a new decision-enriched git commit.
 */
export function registerCommitCommand(
  program: Command,
  infra: EngineInfra,
  prompt: IPrompt
): void {
  const { protocols: protocolMap, logger, config } = infra;
  const cmd = program
    .command('commit')
    .description('Create a decision-enriched commit')
    .option('--subject <text>', 'Primary subject line (why the change was made)')
    .option('--body <text>', 'Body (narrative context)')
    .option('--file <path>', 'Read JSON input from file')
    .option('-i, --interactive', 'Interactive mode (guided prompts)', false)
    .option('--amend', 'Amend the last commit', false)
    .option('--no-edit', 'Keep the existing commit message (use with --amend)', true)
    .option('--trailer <key=value>', 'Add a custom trailer', (val, memo: string[]) => {
      memo.push(val);
      return memo;
    }, []);

  cmd.action(async (_options: CommitCommandOptions, command: Command) => {
    const { git, getFormatter } = infra;
    const options = mergeOptions<CommitCommandOptions>(command);
    
    const isNoEdit = options.edit === false;

    if (isNoEdit && !options.amend) {
      throw new ProtocolError('--no-edit can only be used with --amend', 1);
    }

    const formatter = getFormatter();

    if (options.amend && isNoEdit) {
      // Validation: --no-edit is mutually exclusive with any flag that changes atom data
      const hasCoreInput = !!(options.subject || options.body || options.file || options.interactive);
      const hasTrailers = !!(options.trailer && options.trailer.length > 0);

      // Identify any dynamic protocol-specific flags passed
      const protocolFlags = new Set<string>();
      for (const p of protocolMap.values()) {
          const authorizedKeys = getAuthorizedKeys(p);
          for (const key of authorizedKeys) {
              const def = p.trailers.get(key);
              if (def) protocolFlags.add(def.cli?.flag || slugify(key));
          }
      }
      
      const hasProtocolInput = Object.keys(options).some(k => {
          if (!protocolFlags.has(k)) return false;
          const val = options[k];
          if (Array.isArray(val)) return val.length > 0;
          return !!val;
      });

      if (hasCoreInput || hasTrailers || hasProtocolInput) {
        throw new ProtocolError('--no-edit keeps the existing message unchanged; it cannot be combined with other input flags', 1);
      }

      const hasStaged = await git.hasStagedChanges();
      if (!hasStaged) {
        throw new ProtocolError('No staged changes to commit. Use `git add` to stage files.', 3);
      }

      const result = await git.commit('', { amend: true, noEdit: true });
      console.log(formatter.formatSuccess(result.message, { hash: result.hash }));
      return;
    }

    // Normal path
    if (!options.amend) {
      const hasStaged = await git.hasStagedChanges();
      if (!hasStaged) {
        throw new ProtocolError('No staged changes to commit. Use `git add` to stage files.', 3);
      }
    }

    const input = await resolveCommitInput(options, { prompt, protocols: protocolMap, config });

    // Validate input before building
    const validationIssues = await validateFormatting(input, config, protocolMap);
    const errors = validationIssues.filter(i => i.severity === 'error');
    if (errors.length > 0) {
        throw new ProtocolError(`Validation failed:\n${errors.map(e => `  - ${e.message}`).join('\n')}`, 1);
    }

    let existingIds: Record<string, AtomId> | undefined;
    if (options.amend) {
      existingIds = await readHeadIdentities(git, protocolMap);
    }

    const { message, protocols } = formatCommit(input, config, protocolMap, existingIds);
    const result = await git.commit(message, { amend: options.amend });

    // Log warnings if any (non-fatal)
    const warnings = validationIssues.filter(i => i.severity === 'warning');
    if (warnings.length > 0) {
        for (const w of warnings) logger.warn(w.message);
    }

    logger.result(formatter.formatSuccess(result.message, { 
      hash: result.hash,
      protocols 
    }));
  });
}
