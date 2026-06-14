import { Command } from 'commander';

// Pure Logic Modules
import { getProtocolIdentity } from '../../core/logic/identity.js';
import { getReferenceKeys, resolveProtocolIdentity } from '../../core/logic/protocols.js';
import type { Atom } from '../../core/types/domain.js';
import type { FormattableTraceResult, TraceEdge } from '../../core/types/output.js';
import type { EngineInfra } from '../../services/engine-bootstrapper.js';
import { findAtomsByIds } from '../../shell/orchestrators/discovery.js';
import { ProtocolError } from '../../util/errors.js';
import { mergeOptions } from './helpers/merge-options.js';

/**
 * Register the trace command.
 * Follows decision relationships (Related, Depends-on, Supersedes) to build a graph.
 */
export function registerTraceCommand(
  program: Command,
  infra: EngineInfra,
  defaultProtocol: string
): void {
  program
    .command('trace <id>')
    .description('Follow decision chain from a starting atom')
    .option('--max-depth <n>', 'Maximum BFS traversal depth', (v) => parseInt(v, 10), 10)
    .action(async (id: string, _options: Record<string, unknown>, command: Command) => {
      const options = mergeOptions<{ maxDepth: number; cache: boolean }>(command);
      const { protocols: protocolMap, getFormatter, logger } = infra;
      
      const identity = resolveProtocolIdentity(protocolMap, id, defaultProtocol);
      
      // ONE repository call handles the entire BFS walk up to maxDepth.
      const atoms = await findAtomsByIds(infra, [identity], { 
          follow: true, 
          maxDepth: options.maxDepth,
          cache: options.cache 
      });

      const rootAtom = atoms.find(a => {
          const pName = identity.protocol?.toLowerCase() || '';
          const state = a.protocols.get(pName);
          if (!state) return false;
          const p = protocolMap.get(pName);
          const atomId = p ? getProtocolIdentity(state, p) : null;
          return atomId === identity.id;
      }) || atoms[0];

      if (!rootAtom) {
        throw new ProtocolError(`Start atom "${id}" not found in history`, 1);
      }

      // Build edges for the formatter from the pre-resolved atom set
      const edges: TraceEdge[] = [];
      const visited = new Set<string>();
      const queue: Array<{ atom: Atom; depth: number }> = [{ atom: rootAtom, depth: 0 }];
      
      visited.add(rootAtom.commitHash);

      while (queue.length > 0) {
        const { atom, depth } = queue.shift()!;
        if (depth >= options.maxDepth) continue;

        for (const [pName, state] of atom.protocols.entries()) {
          const p = protocolMap.get(pName);
          if (!p) continue;

          const currentId = getProtocolIdentity(state, p);
          if (!currentId) continue;

          for (const key of getReferenceKeys(p)) {
            const refs = state.trailers[key] || [];
            for (const refId of refs) {
                // Find the target atom in our pre-resolved set
                const targetAtom = atoms.find(a => {
                    const targetState = a.protocols.get(pName.toLowerCase()) || a.protocols.get(pName);
                    return targetState && getProtocolIdentity(targetState, p) === refId;
                });

                edges.push({
                  from: currentId,
                  to: refId,
                  relationship: key,
                  targetAtom: targetAtom ?? null,
                });

                if (targetAtom && !visited.has(targetAtom.commitHash)) {
                  visited.add(targetAtom.commitHash);
                  queue.push({ atom: targetAtom, depth: depth + 1 });
                }
            }
          }
        }
      }

      const formattable: FormattableTraceResult = {
        root: rootAtom,
        edges,
      };

      const formatter = getFormatter();
      logger.result(formatter.formatTraceResult(formattable));
    });
}
