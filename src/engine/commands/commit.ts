import { Command } from 'commander';
import type { CommitBuilder } from '../services/commit-builder.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { Config, CustomTrailerDefinition } from '../types/config.js';
import { ProtocolError } from '../../util/errors.js';
import type { CommitInputResolver } from '../services/commit-input-resolver.js';
import type { HeadIdReader } from '../services/head-id-reader.js';
import { mergeOptions } from './helpers/merge-options.js';
import type { IProtocol } from '../interfaces/protocol.js';
import type { AtomId } from '../types/domain.js';
import type { ProtocolRegistry } from '../services/protocol-registry.js';
import type { TrailerParser } from '../services/trailer-parser.js';

/**
 * CLI Options for the commit command.
 */
interface CommitCommandOptions {
  readonly intent?: string;
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
    config: Config;
    protocol: IProtocol | undefined;
    protocolRegistry: ProtocolRegistry;
    trailerParser: TrailerParser;
  },
): void {
  const { protocolRegistry, protocol } = deps;
  const protocolName = protocol?.name || 'Atom';
  const cmd = program
    .command('commit')
    .description(`Create a ${protocolName}-enriched commit`)
    .option('--intent <text>', 'Intent line (why the change was made)')
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

      const def = p.getDefinition(key) as CustomTrailerDefinition;
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
        const hasOtherInput = !!(options.intent || options.body || options.file || options.trailer?.length || options.interactive);
        
        const baseFlags = ['amend', 'edit', 'intent', 'body', 'file', 'trailer', 'interactive', 'json', 'format', 'color'];
        const hasDynamicFlags = Object.keys(options).some(k => 
          !baseFlags.includes(k) && options[k] !== undefined
        );

        if (hasOtherInput || hasDynamicFlags) {
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

let existingIds: Record<string, AtomId> | undefined;
if (options.amend) {
  existingIds = await headIdReader.readIds();
}

const { message, ids } = commitBuilder.build(input, existingIds);
const result = await gitClient.commit(message, { amend: options.amend });

console.log(formatter.formatSuccess(result.message, { 
  hash: result.hash,
  ids 
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
