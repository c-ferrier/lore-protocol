import { getAuthorizedKeys } from '../../../core/logic/protocols.js';
import type { TrailerDefinition } from '../../../core/types/config.js';
import type { ProtocolContext } from '../../../core/types/protocol-definition.js';
import type { ITrailerCollector } from '../../../interfaces/trailer-collector.js';
import { EnumChoiceTrailerCollector } from './enum-choice-trailer-collector.js';
import { MultiValueTrailerCollector } from './multi-value-trailer-collector.js';

/**
 * Registry and factory for trailer collectors.
 */
export class TrailerCollectorRegistry {
  constructor(private readonly ctx: ProtocolContext) {}

  /**
   * Returns a list of collectors for all authorized trailers.
 */
  getCollectors(): ITrailerCollector[] {
    const collectors: ITrailerCollector[] = [];
    
    // Sort keys by prompt order for deterministic UI sequence
    const authorizedKeys = getAuthorizedKeys(this.ctx);

    const namespace = this.ctx.def.namespace;
    const protocolName = this.ctx.def.name.toLowerCase();

    // Iterate through all authorized keys in protocol-defined order
    for (const key of authorizedKeys) {
      if (key === this.ctx.def.identityKey) continue;

      const tDef = this.ctx.trailers.get(key);
      if (!tDef) continue;

      collectors.push(this.createCollectorFromDefinition(key, tDef, namespace, protocolName));
    }

    return collectors;
  }

  /**
   * Factory method to create the appropriate collector strategy for a definition.
   */
  private createCollectorFromDefinition(
    key: string,
    def: TrailerDefinition,
    namespace: string,
    protocolName: string
  ): ITrailerCollector {
    const prefix = namespace ? `[${namespace}] ` : '';
    const confirmMessage = `${prefix}Set ${key}?`;

    // Case 1: Single-value Enum
    if (def.validation === 'values' && def.values && !def.multivalue) {
      return new EnumChoiceTrailerCollector({
        key,
        protocolName,
        confirmMessage,
        choiceMessage: def.prompt?.choice || `${prefix}${key}:`,
        values: Object.keys(def.values),
      });
    }

    // Case 2: Multi-value List (everything else)
    // This handles multi-value enums, patterns, and free-text lists.
    return new MultiValueTrailerCollector({
      key,
      protocolName,
      confirmMessage,
      inputMessage: def.prompt?.input || `${prefix}${key}:`,
    });
  }
}

/**
 * Functional wrapper for the registry.
 */
export function createTrailerCollectors(ctx: ProtocolContext): ITrailerCollector[] {
  const registry = new TrailerCollectorRegistry(ctx);
  return registry.getCollectors();
}
