import { Command } from 'commander';
import type { CommitBuilder } from '../services/commit-builder.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { CommitInputResolver } from '../services/commit-input-resolver.js';
import type { HeadLoreIdReader } from '../services/head-lore-id-reader.js';
import { LoreError, NoStagedChangesError, ValidationError } from '../util/errors.js';
import type { LoreConfig, CustomTrailerDefinition } from '../types/config.js';
import type { AtomId } from '../types/domain.js';
import type { IProtocol } from '../interfaces/protocol.js';
import { mergeOptions } from './helpers/merge-options.js';

/**
 * CLI Options for the commit command.
 */
interface CommitCommandOptions {
  readonly intent?: string;
  readonly body?: string;
  readonly interactive?: boolean;
  readonly amend?: boolean;
  readonly edit?: boolean;
  readonly trailer?: string[];
  readonly file?: string;
  /** Dynamic core flags from definitions (e.g. confidence, scope-risk) */
  readonly [key: string]: unknown;
}

/**
 * Register the `lore commit` command.
 * Orchestrates the creation of a new decision-enriched git commit.
 * 1. Resolves input (flags, interactive prompts, or JSON).
 * 2. Builds the commit message with protocol trailers.
 * 3. Executes the git commit.
 * --amend: amend the last commit (preserves identity key).
 */
export function registerCommitCommand(
  program: Command,
  deps: {
    commitBuilder: CommitBuilder;
    gitClient: IGitClient;
    commitInputResolver: CommitInputResolver;
    headLoreIdReader: HeadLoreIdReader;
    getFormatter: () => IOutputFormatter;
    config: LoreConfig;
    protocol: IProtocol;
  },
): void {
  const { protocol } = deps;
  const cmd = program
    .command('commit')
    .description(`Create a ${protocol.name}-enriched commit`)
    .option('-m, --intent <text>', 'Primary intent (commit subject)')
    .option('-b, --body <text>', 'Narrative context (commit body)')
    .option('-f, --file <path>', 'Read commit input from a JSON file')
    .option('-i, --interactive', 'Force interactive prompts for trailers', false)
    .option('--amend', 'Amend the previous commit', false)
    .option('--no-edit', 'Use existing message (only for --amend)', true)
    .option('-t, --trailer <key=value>', 'Add a custom trailer', (val, memo: string[]) => {
      memo.push(val);
      return memo;
    }, []);

  // Dynamically add flags for all authorized trailers
  const authorizedKeys = protocol.getAuthorizedKeys();
  for (const key of authorizedKeys) {
    // Skip identity key to maintain perfect parity with 'main' branch UI
    if (key === protocol.identityKey) continue;

    const def = protocol.getDefinition(key) as CustomTrailerDefinition;
    const flagName = def.cli?.flag || slugify(key);
    cmd.option(`--${flagName} <value...>`, def.description);
  }

  cmd.action(async (_options: CommitCommandOptions, command: Command) => {
    const { commitBuilder, gitClient, getFormatter, commitInputResolver, headLoreIdReader } = deps;
    const options = mergeOptions<CommitCommandOptions>(command);
    
    // Commander sets 'edit' to false when --no-edit is used
    const isNoEdit = options.edit === false;

    try {
      if (isNoEdit && !options.amend) {
        throw new LoreError('--no-edit can only be used with --amend', 1);
      }

      // --amend --no-edit: pass through to git, no decision processing
      if (options.amend && isNoEdit) {
        // Enforce that NO other input options are provided with --no-edit
        const hasOtherInput = !!(options.intent || options.body || options.file || options.trailer?.length || options.interactive);
        
        // Check for dynamic core flags
        const baseFlags = ['amend', 'edit', 'intent', 'body', 'file', 'trailer', 'interactive', 'json', 'format', 'color'];
        const hasDynamicFlags = Object.keys(options).some(k => 
          !baseFlags.includes(k) && options[k] !== undefined
        );

        if (hasOtherInput || hasDynamicFlags) {
          throw new LoreError('--no-edit keeps the existing message unchanged; it cannot be combined with other input flags', 1);
        }

        const hasStaged = await gitClient.hasStagedChanges();
        if (!hasStaged) {
          throw new LoreError(
            'No staged changes to commit. Use `git add` to stage files.',
            1,
          );
        }
        const result = await gitClient.commit('', { amend: true, noEdit: true });
        const formatter = getFormatter();
        console.log(formatter.formatSuccess(`Commit created: ${result.hash.slice(0, 7)}`));
        return;
      }

      // Staged changes check for normal commits (and normal amends)
      if (!options.amend) {
        const hasStaged = await gitClient.hasStagedChanges();
        if (!hasStaged) {
          throw new NoStagedChangesError();
        }
      }

      // 1. Resolve input components
      const input = await commitInputResolver.resolve(options);

      // 2. Resolve existing ID if amending
      let existingLoreId: AtomId | undefined;
      if (options.amend) {
        existingLoreId = await headLoreIdReader.read() || undefined;
      }

      // 3. Build the decision atom
      const { message, loreId } = commitBuilder.build(input, existingLoreId);

      // 4. Execute the Git commit
      const result = await gitClient.commit(message, {
        amend: options.amend,
      });

      // 5. Output result
      const formatter = getFormatter();
      const output = formatter.formatSuccess(
        `Commit created: ${result.hash.slice(0, 7)}`,
        { hash: result.hash, lore_id: loreId },
      );
      console.log(output);
    } catch (error) {
      if (error instanceof NoStagedChangesError || error instanceof ValidationError || error instanceof LoreError) {
        throw error;
      }
      throw error;
    }
  });
}

/**
 * Helper to convert a trailer key to a safe CLI flag name.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
