import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { Atom, AtomId } from '../types/domain.js';
import type { FormattableTraceResult, TraceEdge } from '../types/output.js';
import { ProtocolError } from '../util/errors.js';
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
    .action(async (id: string) => {
      const { atomRepository, getFormatter, protocol } = deps;

      if (!protocol.isValidIdentity(id)) {
        throw new ProtocolError(
          `Invalid ${protocol.identityKey} format: "${id}". Must be 8-character hex.`,
          1,
        );
      }

      const rootAtom = await atomRepository.findById(id);
      if (rootAtom === null) {
        throw new ProtocolError(
          `${protocol.identityKey} "${id}" not found in commit history.`,
          1,
        );
      }

      const edges: TraceEdge[] = [];
      const visited = new Set<string>();
      const queue: Array<{ atom: Atom; depth: number }> = [
        { atom: rootAtom, depth: 0 },
      ];

      visited.add(rootAtom.id);

      // BFS to find all relationships
      // Limit depth to avoid infinite loops or massive graphs
      const MAX_DEPTH = 5;

      while (queue.length > 0) {
        const { atom, depth } = queue.shift()!;
        if (depth >= MAX_DEPTH) continue;

        const refKeys = protocol.getReferenceKeys();
        const state = atom.protocols.get(protocol.name.toLowerCase());

        if (state) {
          for (const key of refKeys) {
            const refs = state.trailers[key] || [];
            for (const refId of refs) {
              if (!protocol.isValidIdentity(refId)) continue;

              const targetAtom = await atomRepository.findById(refId);
              const edge: TraceEdge = {
                from: atom.id,
                to: refId,
                relationship: key as 'Related' | 'Supersedes' | 'Depends-on',
                targetAtom: targetAtom ?? null,
              };

              edges.push(edge);

              if (targetAtom && !visited.has(targetAtom.id)) {
                visited.add(targetAtom.id);
                queue.push({ atom: targetAtom, depth: depth + 1 });
              }
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
