import { Command } from 'commander';
import type { CommitBuilder } from '../services/commit-builder.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { TrailerDefinition } from '../types/config.js';
import { ProtocolError } from '../../util/errors.js';
import type { CommitInputResolver } from '../services/commit-input-resolver.js';
import type { HeadIdReader } from '../services/head-id-reader.js';
import type { ILogger } from '../interfaces/logger.js';
import { mergeOptions } from './helpers/merge-options.js';
import type { AtomId } from '../types/domain.js';
import { ProtocolRegistry } from '../services/protocol-registry.js';
import { TrailerParser } from '../services/trailer-parser.js';
import { slugify } from '../../util/string.js';

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
  deps: {
    commitBuilder: CommitBuilder;
    gitClient: IGitClient;
    commitInputResolver: CommitInputResolver;
    headIdReader: HeadIdReader;
    getFormatter: () => IOutputFormatter;
    protocolRegistry: ProtocolRegistry;
    trailerParser: TrailerParser;
    logger: ILogger;
  },
): void {
  const { protocolRegistry, logger } = deps;
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

  // Register flags for all registered protocols
  for (const p of protocolRegistry.getAll()) {
    const isRoot = p.namespace === '';
    const prefix = p.namespace ? `${p.namespace}-` : '';
    const authorizedKeys = p.getAuthorizedKeys();
    
    for (const key of authorizedKeys) {
      if (key === p.identityKey) continue;

      const def = p.getDefinition(key) as TrailerDefinition;
      const flagName = def.cli?.flag || slugify(key);
      
      const fullFlag = isRoot ? flagName : `${prefix}${flagName}`;
      
      if (!cmd.options.some(o => o.long === `--${fullFlag}`)) {
        cmd.option(`--${fullFlag} <value...>`, `[${p.name}] ${def.description}`);
      }
    }
  }

  cmd.action(async (_options: CommitCommandOptions, command: Command) => {
    const { gitClient, getFormatter, commitInputResolver, headIdReader, commitBuilder } = deps;
    const options = mergeOptions<CommitCommandOptions>(command);
    
    const isNoEdit = options.edit === false;

    try {
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
        for (const p of protocolRegistry.getAll()) {
            for (const key of p.getAuthorizedKeys()) {
                const def = p.getDefinition(key) as TrailerDefinition;
                protocolFlags.add(def.cli?.flag || slugify(key));
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

        const hasStaged = await gitClient.hasStagedChanges();
        if (!hasStaged) {
          throw new ProtocolError('No staged changes to commit. Use `git add` to stage files.', 3);
        }

        const result = await gitClient.commit('', { amend: true, noEdit: true });
        console.log(formatter.formatSuccess(result.message, { hash: result.hash }));
        return;
      }

// Normal path
if (!options.amend) {
  const hasStaged = await gitClient.hasStagedChanges();
  if (!hasStaged) {
    throw new ProtocolError('No staged changes to commit. Use `git add` to stage files.', 3);
  }
}
const input = await commitInputResolver.resolve(options);

// Validate input before building
const validationIssues = commitBuilder.validate(input);
const errors = validationIssues.filter(i => i.severity === 'error');
if (errors.length > 0) {
    throw new ProtocolError(`Validation failed:\n${errors.map(e => `  - ${e.message}`).join('\n')}`, 1);
}

let existingIds: Record<string, AtomId> | undefined;
if (options.amend) {
  existingIds = await headIdReader.readIds();
}

const { message, protocols } = commitBuilder.build(input, existingIds);
const result = await gitClient.commit(message, { amend: options.amend });

// Log warnings if any (non-fatal)
const warnings = validationIssues.filter(i => i.severity === 'warning');
if (warnings.length > 0) {
    const { logger } = deps;
    for (const w of warnings) logger.warn(w.message);
}

console.log(formatter.formatSuccess(result.message, { 
  hash: result.hash,
  protocols 
}));
} catch (error) {
if (error instanceof ProtocolError) {
  const formatter = getFormatter();
  console.error(formatter.formatError(error.exitCode || 1, [{ severity: 'error', message: error.message }]));

  // Use commander's error handling if possible, or only exit if not in test
  if ((command as any)._exitCallback) {
      throw error;
  }
  process.exit(error.exitCode || 1);
}
throw error;
}

  });
}
