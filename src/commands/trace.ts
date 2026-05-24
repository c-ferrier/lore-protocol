import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { Atom, AtomId } from '../types/domain.js';
import type { FormattableTraceResult, TraceEdge } from '../types/output.js';
import { LoreError } from '../util/errors.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IProtocol } from '../interfaces/protocol.js';

/**
 * Register the `lore trace <id>` command.
 * Finds an atom by its identity key, then BFS through all references to build
 * a graph of related decisions.
 *
 * SRP: CLI integration for decision tracing.
 * GRASP: Information Expert -- relies on AtomRepository for BFS data.
 */
export function registerTraceCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    gitClient: IGitClient;
    getFormatter: () => IOutputFormatter;
    protocol: IProtocol;
  },
): void {
  program
    .command('trace <id>')
    .description('Trace the lineage and relationships of a decision')
    .action(async (loreId: string) => {
      const { atomRepository, getFormatter, protocol } = deps;

      if (!protocol.isValidIdentity(loreId)) {
        throw new LoreError(
          `Invalid ${protocol.identityKey} format: "${loreId}". Must be 8-character hex.`,
          1,
        );
      }

      const rootAtom = await atomRepository.findByLoreId(loreId);
      if (rootAtom === null) {
        throw new LoreError(
          `${protocol.identityKey} "${loreId}" not found in commit history.`,
          1,
        );
      }

      const edges: TraceEdge[] = [];
      const visited = new Set<string>();
      const queue: Array<{ atom: Atom; depth: number }> = [
        { atom: rootAtom, depth: 0 },
      ];

      visited.add(rootAtom.loreId);

      // BFS to find all relationships
      // Limit depth to avoid infinite loops or massive graphs
      const MAX_DEPTH = 5;

      while (queue.length > 0) {
        const { atom, depth } = queue.shift()!;
        if (depth >= MAX_DEPTH) continue;

        const refKeys = protocol.getReferenceKeys();

        for (const key of refKeys) {
          const refs = atom.trailers[key] || [];
          for (const refId of refs) {
            if (!protocol.isValidIdentity(refId)) continue;

            const targetAtom = await atomRepository.findByLoreId(refId);
            const edge: TraceEdge = {
              from: atom.loreId,
              to: refId,
              relationship: key as 'Related' | 'Supersedes' | 'Depends-on',
              targetAtom: targetAtom ?? null,
            };

            edges.push(edge);

            if (targetAtom && !visited.has(targetAtom.loreId)) {
              visited.add(targetAtom.loreId);
              queue.push({ atom: targetAtom, depth: depth + 1 });
            }
          }
        }
      }

      const traceResult: FormattableTraceResult = {
        root: rootAtom,
        edges,
      };

      const formatter = getFormatter();
      console.log(formatter.formatTraceResult(traceResult));
    });
}
