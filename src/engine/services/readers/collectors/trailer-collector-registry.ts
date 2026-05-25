import type { ITrailerCollector } from '../../../interfaces/trailer-collector.js';
import type { CustomTrailerDefinition } from '../../../types/config.js';
import { MultiValueTrailerCollector } from './multi-value-trailer-collector.js';
import { EnumChoiceTrailerCollector } from './enum-choice-trailer-collector.js';
import { IProtocol } from '../../../interfaces/protocol.js';

/**
 * Registry and factory for trailer collectors.
 *
 * Collectors are created in the correct prompt order defined by the protocol metadata.
 *
 * GRASP: Creator -- centralizes collector instantiation with protocol knowledge.
 * SOLID: SRP -- only responsible for collector instantiation.
 * SOLID: OCP -- new collector types can be added by extending the factory.
 */
export class TrailerCollectorRegistry {
  constructor(private readonly protocol: IProtocol) {}

  /**
   * Returns a list of collectors for all authorized trailers.
   */
  getCollectors(): ITrailerCollector[] {
    const collectors: ITrailerCollector[] = [];
    const authorizedKeys = this.protocol.getAuthorizedKeys();

    // Iterate through all authorized keys in protocol-defined order
    for (const key of authorizedKeys) {
      if (key === this.protocol.identityKey) continue;

      const def = this.protocol.getDefinition(key);
      if (!def) continue;

      collectors.push(this.createCollectorFromDefinition(key, def));
    }

    return collectors;
  }

  /**
   * Factory method to create the appropriate collector strategy for a definition.
   */
  private createCollectorFromDefinition(
    key: string,
    def: CustomTrailerDefinition,
  ): ITrailerCollector {
    const confirmMessage = `Set ${key}?`;

    // Case 1: Single-value Enum
    if (def.validation === 'values' && def.values && !def.multivalue) {
      return new EnumChoiceTrailerCollector({
        key,
        confirmMessage,
        choiceMessage: def.prompt?.choice || `${key}:`,
        values: Object.keys(def.values),
      });
    }

    // Case 2: Multi-value List (everything else)
    // This handles multi-value enums, patterns, and free-text lists.
    return new MultiValueTrailerCollector({
      key,
      confirmMessage,
      inputMessage: def.prompt?.input || `${key}:`,
    });
  }
}

/**
 * Functional wrapper for the registry.
 */
export function createTrailerCollectors(protocol: IProtocol): ITrailerCollector[] {
  const registry = new TrailerCollectorRegistry(protocol);
  return registry.getCollectors();
}
