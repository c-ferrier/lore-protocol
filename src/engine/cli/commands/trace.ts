import type { Command } from 'commander';
import type { AtomRepository } from '../../services/atom-repository.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { Atom, AtomId } from '../../core/types/domain.js';
import type { FormattableTraceResult, TraceEdge } from '../../core/types/output.js';
import { ProtocolError } from '../../util/errors.js';
import type { IGitClient } from '../../interfaces/git-client.js';
import {  ActiveProtocol  } from '../../core/models/active-protocol.js';
import type { ILogger } from '../../interfaces/logger.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';

import { mergeOptions } from './helpers/merge-options.js';

/**
 * Register the ` trace <id>` command.
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
    protocolRegistry: ProtocolRegistry;
    logger: ILogger;
  },
): void {
  program
    .command('trace <id>')
    .description('Trace the lineage and relationships of a decision')
    .option('--max-depth <n>', 'Maximum BFS traversal depth', (val) => parseInt(val, 10), 10)
    .action(async (id: string, _options: any, command: Command) => {
      const options = mergeOptions<{ maxDepth: number; cache: boolean }>(command);
      const { atomRepository, getFormatter, protocolRegistry, logger } = deps;

      // 1. Resolve Initial Identity
      const identity = protocolRegistry.resolveIdentity(id);
      
      // 2. Perform Integrated Trace (Expansion + Truth)
      // ONE repository call handles the entire BFS walk up to maxDepth.
      const atoms = await atomRepository.findByIds([identity], { 
          follow: true, 
          maxDepth: options.maxDepth,
          cache: options.cache 
      });

      const rootAtom = atoms.find(a => {
          const state = a.protocols.get(identity.protocol?.toLowerCase() || '');
          if (!state) return false;
          const atomId = protocolRegistry.get(identity.protocol || '')?.getIdentity(state);
          return atomId === identity.id;
      }) || atoms[0]; // Fallback to first if ambiguity

      if (!rootAtom) {
        throw new ProtocolError(`Atom "${id}" not found in history.`, 1);
      }

      // 3. Build edges for the formatter
      // The formatter still needs edges, but we build them from the pre-resolved atom set.
      const edges: TraceEdge[] = [];
      const visited = new Set<string>();
      const queue: Array<{ atom: Atom; depth: number }> = [{ atom: rootAtom, depth: 0 }];
      
      visited.add(id);

      while (queue.length > 0) {
          const { atom, depth } = queue.shift()!;
          if (depth >= options.maxDepth) continue;

          for (const [pName, state] of atom.protocols) {
              const protocol = protocolRegistry.get(pName);
              if (!protocol) continue;

              const currentId = protocol.getIdentity(state);
              if (!currentId) continue;

              for (const key of protocol.getReferenceKeys()) {
                  const refs = state.trailers[key] || [];
                  for (const refId of refs) {
                      // Find the target atom in our pre-resolved set
                      const targetAtom = atoms.find(a => {
                          const targetState = a.protocols.get(pName);
                          return protocol.getIdentity(targetState) === refId;
                      });

                      edges.push({
                          from: currentId,
                          to: refId,
                          relationship: key,
                          targetAtom: targetAtom ?? null
                      });

                      if (targetAtom && !visited.has(refId)) {
                          visited.add(refId);
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
      logger.result(formatter.formatTraceResult(traceResult));
    });
}
