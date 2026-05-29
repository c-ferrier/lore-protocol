import type { TrailerDefinition, ValueDefinition, TrailerUiKind, TrailerUiColor } from '../types/config.js';
import { TRAILER_UI_KINDS, TRAILER_UI_COLORS } from '../../util/constants.js';

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
  static hydrateTrailer(key: string, raw: any): TrailerDefinition {
    if (!raw || typeof raw !== 'object') {
      // Degraded state: return a generic definition
      return {
        description: typeof raw === 'string' ? raw : `Trailer: ${key}`,
        multivalue: true,
        validation: 'none',
      };
    }

    const def = raw as any;

    // 1. Resolve Validation Type & Aliases
    let validation: 'values' | 'pattern' | 'reference' | 'none' = 'none';
    const rawVal = def.validation || def.type; // 'type' is a common alias
    if (rawVal === 'values' || rawVal === 'options' || rawVal === 'enum') {
      validation = 'values';
    } else if (rawVal === 'pattern' || rawVal === 'regex') {
      validation = 'pattern';
    } else if (rawVal === 'reference' || rawVal === 'id') {
      validation = 'reference';
    }

    // 2. Resolve Directives
    const directives = Array.isArray(def.directives)
      ? def.directives.filter((d: any): d is string => typeof d === 'string')
      : undefined;

    // 3. Resolve UI Hints
    const uiRaw = typeof def.ui === 'object' && def.ui !== null ? def.ui : undefined;
    const ui = uiRaw ? {
      kind: (TRAILER_UI_KINDS as readonly string[]).includes(uiRaw.kind as string) 
        ? uiRaw.kind as TrailerUiKind 
        : undefined,
      color: (TRAILER_UI_COLORS as readonly string[]).includes(uiRaw.color as string) 
        ? uiRaw.color as TrailerUiColor 
        : undefined,
    } : undefined;

    // 4. Construct Final Object (Filtering unknown keys)
    return {
      description: typeof def.description === 'string' ? def.description : '',
      multivalue: typeof def.multivalue === 'boolean' ? def.multivalue : false,
      validation,
      values: this.hydrateValues(def.values || def.options),
      pattern: typeof def.pattern === 'string' ? def.pattern : undefined,
      required: typeof def.required === 'boolean' ? def.required : false,
      isCore: typeof def.isCore === 'boolean' ? def.isCore : undefined,
      directives,
      ui,
      cli: def.cli ? {
          flag: typeof def.cli.flag === 'string' ? def.cli.flag : undefined,
      } : undefined,
      prompt: def.prompt ? {
          confirm: typeof def.prompt.confirm === 'string' ? def.prompt.confirm : undefined,
          input: typeof def.prompt.input === 'string' ? def.prompt.input : undefined,
          choice: typeof def.prompt.choice === 'string' ? def.prompt.choice : undefined,
          order: typeof def.prompt.order === 'number' ? def.prompt.order : undefined,
      } : undefined,
      squash: ['union', 'rank-min', 'rank-max'].includes(def.squash) ? def.squash : undefined,
      generator: ['hex8', 'uuid', 'none'].includes(def.generator) ? def.generator : undefined,
      crossProtocol: typeof def.crossProtocol === 'boolean' ? def.crossProtocol : undefined,
    };
  }

  /**
   * Normalizes enum values.
   */
  private static hydrateValues(valuesRaw: any): Record<string, ValueDefinition> | undefined {
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
          const optDef = value as any;
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
