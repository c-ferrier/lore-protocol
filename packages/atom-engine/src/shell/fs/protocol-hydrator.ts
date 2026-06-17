import type { StaleIfCondition,TrailerDefinition, TrailerUiColor,TrailerUiKind, ValueDefinition } from '../../core/types/config.js';
import { TRAILER_UI_COLORS,TRAILER_UI_KINDS } from '../../util/constants.js';

/**
 * Utility to hydrate raw objects into formal TrailerDefinitions.
 * 
 * Responsibility: Enforce strict schema boundaries, handle aliases (options -> values),
 * and set sensible defaults.
 * 
 * SOLID: SRP -- The single source of truth for how a Trailer object is constructed.
 */
export class ProtocolHydrator {
  /**
   * Hydrates a single trailer definition.
   */
  static hydrateTrailer(key: string, raw: unknown): TrailerDefinition {
    if (!raw || typeof raw !== 'object') {
      return {
        description: typeof raw === 'string' ? raw : `Trailer: ${key}`,
        multivalue: true,
        validation: 'none',
      };
    }

    const def = raw as Record<string, unknown>;

    // 1. Resolve Validation Type & Aliases
    let validation: 'values' | 'pattern' | 'reference' | 'none' = 'none';
    const rawVal = def.validation || def.type;
    if (rawVal === 'values' || rawVal === 'options' || rawVal === 'enum') {
      validation = 'values';
    } else if (rawVal === 'pattern' || rawVal === 'regex') {
      validation = 'pattern';
    } else if (rawVal === 'reference' || rawVal === 'id') {
      validation = 'reference';
    }

    // 2. Resolve Directives
    const directives = Array.isArray(def.directives)
      ? def.directives.filter((d: unknown): d is string => typeof d === 'string')
      : undefined;

    // 3. Resolve UI Hints
    const uiRaw = typeof def.ui === 'object' && def.ui !== null ? (def.ui as Record<string, unknown>) : undefined;
    const ui = uiRaw ? {
      kind: (TRAILER_UI_KINDS as readonly string[]).includes(uiRaw.kind as string) 
        ? uiRaw.kind as TrailerUiKind 
        : undefined,
      color: (TRAILER_UI_COLORS as readonly string[]).includes(uiRaw.color as string) 
        ? uiRaw.color as TrailerUiColor 
        : undefined,
    } : undefined;

    // 4. Construct Final Object
    const result: TrailerDefinition = {
      description: typeof def.description === 'string' ? def.description : '',
      multivalue: typeof def.multivalue === 'boolean' ? def.multivalue : false,
      validation,
      values: this.hydrateValues(def.values || def.options),
      pattern: typeof def.pattern === 'string' ? def.pattern : undefined,
      required: typeof def.required === 'boolean' ? def.required : false,
      directives,
      ui,
      cli: (typeof def.cli === 'object' && def.cli !== null) ? {
          flag: typeof (def.cli as Record<string, unknown>).flag === 'string' ? (def.cli as Record<string, unknown>).flag as string : undefined,
      } : undefined,
      prompt: (typeof def.prompt === 'object' && def.prompt !== null) ? {
          confirm: typeof (def.prompt as Record<string, unknown>).confirm === 'string' ? (def.prompt as Record<string, unknown>).confirm as string : undefined,
          input: typeof (def.prompt as Record<string, unknown>).input === 'string' ? (def.prompt as Record<string, unknown>).input as string : undefined,
          choice: typeof (def.prompt as Record<string, unknown>).choice === 'string' ? (def.prompt as Record<string, unknown>).choice as string : undefined,
          order: typeof (def.prompt as Record<string, unknown>).order === 'number' ? (def.prompt as Record<string, unknown>).order as number : undefined,
      } : undefined,
      squash: ['union', 'rank-min', 'rank-max'].includes(def.squash as string) ? def.squash as 'union' | 'rank-min' | 'rank-max' : undefined,
      generator: ['hex8', 'uuid', 'none'].includes(def.generator as string) ? def.generator as 'hex8' | 'uuid' | 'none' : undefined,
      crossProtocol: typeof def.crossProtocol === 'boolean' ? def.crossProtocol : undefined,
      stale_if: def.stale_if as StaleIfCondition | readonly StaleIfCondition[],
    };

    // Rule: Only include isCore if explicitly provided. 
    // This allows merges to preserve the original isCore value from the base schema.
    if (typeof def.isCore === 'boolean') {
        Object.assign(result, { isCore: def.isCore });
    }

    return result;
  }

  /**
   * Hydrates a collection of trailer definitions.
   */
  static hydrateAll(rawData: Record<string, unknown>): Record<string, TrailerDefinition> {
    const result: Record<string, TrailerDefinition> = {};
    for (const [key, value] of Object.entries(rawData)) {
      result[key] = this.hydrateTrailer(key, value);
    }
    return result;
  }

  /**
   * Normalizes enum values.
   */
  private static hydrateValues(valuesRaw: unknown): Record<string, ValueDefinition> | undefined {
    if (Array.isArray(valuesRaw)) {
      const result: Record<string, ValueDefinition> = {};
      for (const opt of valuesRaw) {
        if (typeof opt === 'string') result[opt] = { description: '' };
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }

    if (valuesRaw && typeof valuesRaw === 'object') {
      const result: Record<string, ValueDefinition> = {};
      for (const [key, value] of Object.entries(valuesRaw)) {
        if (typeof value === 'string') {
          result[key] = { description: value };
        } else if (value && typeof value === 'object') {
          const optDef = value as Record<string, unknown>;
          result[key] = {
            description: typeof optDef.description === 'string' ? optDef.description : '',
          };
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }

    return undefined;
  }
}
