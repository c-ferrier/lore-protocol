import type { ActiveTrailer } from '../../interfaces/protocol.js';
import type { IProtocolSchema } from '../../interfaces/protocol/protocol-schema.js';
import type { TrailerUiKind, TrailerUiColor, ValueDefinition } from '../../types/config.js';
import type { FormattableTrailerDefinition } from '../../types/output.js';

/**
 * Implementation of the Protocol Schema capability.
 * Owns definitions, authorization, and semantic metadata.
 */
export class ProtocolSchema implements IProtocolSchema {
  constructor(
    private readonly definitions: Map<string, ActiveTrailer>,
    private readonly caseMap: Map<string, string>,
    private readonly permissive: boolean
  ) {}

  owns(key: string): boolean {
    const lowerKey = key.toLowerCase();
    // Logic moved from Protocol.owns (ignoring namespacing for now as it's handled by Facade)
    return (
      this.caseMap.has(lowerKey)
    );
  }

  isCore(key: string): boolean {
    return this.getDefinition(key)?.isCore ?? false;
  }

  authorize(key: string): string | null {
    const canonicalKey = this.caseMap.get(key.toLowerCase());
    if (canonicalKey) {
      return canonicalKey;
    }

    if (this.permissive) {
      return key;
    }

    return null;
  }

  getDefinition(key: string): ActiveTrailer | null {
    const canonicalKey = this.caseMap.get(key.toLowerCase());
    return canonicalKey ? this.definitions.get(canonicalKey) || null : null;
  }

  getAuthorizedKeys(): string[] {
    return Array.from(this.definitions.values())
      .sort((a, b) => (a.prompt?.order ?? 1000) - (b.prompt?.order ?? 1000))
      .map((d) => d.key);
  }

  getAllKeys(): string[] {
    return Array.from(this.definitions.keys());
  }

  getScalarKeys(): string[] {
    return Array.from(this.definitions.values())
      .filter((d) => !d.multivalue)
      .map((d) => d.key);
  }

  getListKeys(): string[] {
    return Array.from(this.definitions.values())
      .filter((d) => d.multivalue)
      .map((d) => d.key);
  }

  getReferenceKeys(): string[] {
    return Array.from(this.definitions.values())
      .filter((d) => d.validation === 'reference' || d.ui?.kind === 'reference')
      .map((d) => d.key);
  }

  getUiKind(key: string): TrailerUiKind {
    return this.getDefinition(key)?.ui?.kind || 'custom';
  }

  getUiColor(key: string): TrailerUiColor {
    return this.getDefinition(key)?.ui?.color || 'cyan';
  }

  getFormattableDefinitions(): Record<string, FormattableTrailerDefinition> {
    const result: Record<string, FormattableTrailerDefinition> = {};
    for (const [key, def] of this.definitions.entries()) {
      result[key] = {
        description: def.description,
        multivalue: def.multivalue,
        validation: def.validation,
        values: this.normalizeValues(def.values),
        pattern: def.pattern,
        required: def.required,
        isCore: !!def.isCore,
        crossProtocol: def.crossProtocol,
        directives: def.directives ?? [],
        ui: def.ui,
      };
    }
    return result;
  }

  private normalizeValues(
    values?: Record<string, string | ValueDefinition>,
  ): Record<string, ValueDefinition> | undefined {
    if (!values) return undefined;

    const result: Record<string, ValueDefinition> = {};
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === 'string') {
        result[key] = { description: value };
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
