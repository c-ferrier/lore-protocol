import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { Atom, AtomId } from '../types/domain.js';
import type { FormattableTraceResult, TraceEdge } from '../types/output.js';
import { ProtocolError } from '../../util/errors.js';
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

      const rootProtocolName = protocol.name.toLowerCase();
      const getAtomId = (a: Atom) => protocol.getIdentity(a.protocols.get(rootProtocolName)?.trailers);

      const rootId = getAtomId(rootAtom);
      if (!rootId) throw new Error('Root atom has no valid identity for the active protocol.');

      visited.add(rootId);

      // BFS to find all relationships
      // Limit depth to avoid infinite loops or massive graphs
      const MAX_DEPTH = 5;

      while (queue.length > 0) {
        const { atom, depth } = queue.shift()!;
        if (depth >= MAX_DEPTH) continue;

        const currentId = getAtomId(atom);
        if (!currentId) continue;

        const refKeys = protocol.getReferenceKeys();
        const state = atom.protocols.get(rootProtocolName);

        if (state) {
          for (const key of refKeys) {
            const refs = state.trailers[key] || [];
            for (const refId of refs) {
              if (!protocol.isValidIdentity(refId)) continue;

              const targetAtom = await atomRepository.findById(refId);
              const edge: TraceEdge = {
                from: currentId,
                to: refId,
                relationship: key as 'Related' | 'Supersedes' | 'Depends-on',
                targetAtom: targetAtom ?? null,
              };

              edges.push(edge);

              if (targetAtom) {
                const targetId = getAtomId(targetAtom);
                if (targetId && !visited.has(targetId)) {
                  visited.add(targetId);
                  queue.push({ atom: targetAtom, depth: depth + 1 });
                }
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
