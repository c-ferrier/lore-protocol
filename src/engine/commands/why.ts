import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { PathResolver } from '../services/path-resolver.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { Atom, SupersessionStatus } from '../types/domain.js';
import type { QueryResult, QueryMeta } from '../types/query.js';
import type { FormattableQueryResult } from '../types/output.js';
import { ProtocolError } from '../../util/errors.js';
import { addPathQueryOptions, type PathQueryCommandOptions } from './helpers/path-query.js';
import { mergeOptions } from './helpers/merge-options.js';
import type { ProtocolRegistry } from '../services/protocol-registry.js';

/**
 * Register the `why <target>` command.
 * Target must be `file:line` or `file:line-line` format.
 * Uses git blame to find the commit for each line, then extracts trailers.
 *
 * Performance: queries only the specific blame commits (one git log per unique hash)
 * rather than loading all atoms from history.
 */
export function registerWhyCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    gitClient: IGitClient;
    pathResolver: PathResolver;
    getFormatter: () => IOutputFormatter;
    protocolRegistry: ProtocolRegistry;
  },
): void {
  const cmd = program
    .command('why <target>')
    .description('Decision context for a specific line or line range');

  addPathQueryOptions(cmd);

  cmd.action(async (target: string, _options: PathQueryCommandOptions, command: Command) => {
    const { atomRepository, gitClient, pathResolver, getFormatter, protocolRegistry } = deps;
    
    if (protocolRegistry.getAll().length === 0) {
        throw new Error('At least one protocol must be registered to run this command.');
    }

    const options = mergeOptions<PathQueryCommandOptions>(command);

    const parsedTarget = pathResolver.parseTarget(target);

    if (parsedTarget.type !== 'line-range' || parsedTarget.lineStart === null) {
      throw new ProtocolError(
        `Target must be file:line or file:line-line format (got "${target}")`,
        1,
      );
    }

    const blameArgs = pathResolver.toGitBlameArgs(parsedTarget);
    const blameLines = await gitClient.blame(
      blameArgs.file,
      blameArgs.lineStart,
      blameArgs.lineEnd,
    );

    if (blameLines.length === 0) {
      throw new ProtocolError(`No blame data found for ${target}`, 1);
    }

    // Collect unique commit hashes from blame
    const commitHashes = new Set<string>();
    for (const line of blameLines) {
      commitHashes.add(line.commitHash);
    }

    // For each unique commit hash, use atomRepository to look up the atom
    let atoms: Atom[] = [];
    const seenIds = new Set<string>();

    for (const hash of commitHashes) {
      const atom = await atomRepository.findByCommitHash(hash);
      if (atom === null) {
        continue;
      }

      // Use the primary identity for deduplication
      const id = protocolRegistry.getIdentity(atom);
      if (!id || seenIds.has(id)) {
        continue;
      }

      atoms.push(atom);
      seenIds.add(id);
    }

    const totalAtoms = atoms.length;

    // Apply limit if provided
    if (options.limit !== undefined && options.limit > 0) {
      atoms = atoms.slice(0, options.limit);
    }

    // Build result
    const meta: QueryMeta = {
      totalAtoms,
      filteredAtoms: atoms.length,
      oldest: totalAtoms > 0
        ? new Date(Math.min(...atoms.map((a) => a.date.getTime())))
        : null,
      newest: totalAtoms > 0
        ? new Date(Math.max(...atoms.map((a) => a.date.getTime())))
        : null,
    };

    const result: QueryResult = {
      command: 'why',
      target,
      targetType: 'line-range',
      atoms,
      meta,
    };

    // Build a minimal supersession map (no supersession filtering for why)
    const supersessionMap = new Map<string, SupersessionStatus>();
    for (const atom of atoms) {
      const id = protocolRegistry.getIdentity(atom);
      if (id) {
        supersessionMap.set(id, {
          superseded: false,
          supersededBy: null,
        });
      }
    }

    const formattable: FormattableQueryResult = {
      result,
      supersessionMap,
      visibleTrailers: 'all',
    };

    const formatter = getFormatter();
    console.log(formatter.formatQueryResult(formattable));
  });
}
