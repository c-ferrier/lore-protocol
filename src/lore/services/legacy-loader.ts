import { readFile, access } from 'node:fs/promises';
import { parse as parseToml } from 'smol-toml';
import type { EngineConfig, CustomTrailerDefinition, ValueDefinition } from '../../engine/types/config.js';
import { TRAILER_UI_KINDS, TRAILER_UI_COLORS } from '../../util/constants.js';
import type { TrailerUiKind, TrailerUiColor } from '../../engine/types/config.js';

/**
 * DeepPartial helper for nested configuration overrides.
 */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[P] extends object
    ? DeepPartial<T[P]>
    : T[P];
};

/**
 * Responsibility: Parse .lore/config.toml and translate to Agnostic Engine state.
 * 
 * SOLID: OCP -- the engine doesn't change, but Lore's wrapper interprets 
 * legacy settings into engine overrides.
 */
export class LoreLegacyLoader {
  constructor(private readonly configPath: string) {}

  /**
   * Loads the legacy config and returns a combined state.
   */
  async load(): Promise<{ 
    engineOverrides: DeepPartial<EngineConfig>;
    protocolConfig: any; // Using any for mutable intermediate state
  } | null> {
    try {
      if (!(await this.exists())) return null;

      const content = await readFile(this.configPath, 'utf-8');
      const raw = parseToml(content) as any;

      const protocolConfig: any = {};
      const engineOverrides: any = { validation: {}, stale: {}, output: {}, cli: {} };

      // 1. Lore Version
      if (raw.protocol?.version) protocolConfig.version = raw.protocol.version;

      // 2. Trailers Section
      if (raw.trailers) {
          protocolConfig.trailers = {
              required: raw.trailers.required || [],
              custom: raw.trailers.custom || [],
              definitions: this.resolveDefinitions(raw.trailers.definitions || {}),
              permissive: raw.trailers.permissive !== undefined ? raw.trailers.permissive : true
          };

          // 0.5.0 Legacy Rule: If ANY custom definitions exist, permissive mode defaults to false 
          // unless explicitly set to true.
          if (Object.keys(protocolConfig.trailers.definitions).length > 0 && raw.trailers.permissive === undefined) {
              protocolConfig.trailers.permissive = false;
          }
      }

      // 3. Validation (Nomenclature Translation)
      if (raw.validation) {
          if (raw.validation.strict !== undefined) engineOverrides.validation.strict = raw.validation.strict;
          if (raw.validation.max_message_lines !== undefined) engineOverrides.validation.maxMessageLines = raw.validation.max_message_lines;
          
          // MAP: intent_max_length -> subjectMaxLength
          if (raw.validation.intent_max_length !== undefined) {
              engineOverrides.validation.subjectMaxLength = raw.validation.intent_max_length;
          } else if (raw.validation.subject_max_length !== undefined) {
              engineOverrides.validation.subjectMaxLength = raw.validation.subject_max_length;
          }
      }

      // 4. Stale
      if (raw.stale) {
          if (raw.stale.older_than) engineOverrides.stale.olderThan = raw.stale.older_than;
          if (raw.stale.drift_threshold) engineOverrides.stale.driftThreshold = raw.stale.drift_threshold;
      }

      // 5. Output
      if (raw.output) {
          if (raw.output.default_format) engineOverrides.output.defaultFormat = raw.output.default_format;
      }

      // 6. CLI
      if (raw.cli) {
          if (raw.cli.update_check !== undefined) engineOverrides.cli.updateCheck = raw.cli.update_check;
          if (raw.cli.cache !== undefined) engineOverrides.cli.cache = raw.cli.cache;
      }

      return { engineOverrides, protocolConfig };
    } catch {
      return null;
    }
  }

  private async exists(): Promise<boolean> {
      try {
          await access(this.configPath);
          return true;
      } catch {
          return false;
      }
  }

  private resolveDefinitions(rawData: Record<string, any>): Record<string, CustomTrailerDefinition> {
    const result: Record<string, CustomTrailerDefinition> = {};

    for (const [key, value] of Object.entries(rawData)) {
      if (!value || typeof value !== 'object') continue;
      const def = value as any;
      
      let validation: 'values' | 'pattern' | 'none' = 'none';
      if (def.validation === 'values' || def.validation === 'options') {
        validation = 'values';
      } else if (def.validation === 'pattern') {
        validation = 'pattern';
      }

      const uiRaw = typeof def.ui === 'object' && def.ui !== null ? def.ui : undefined;

      result[key] = {
        description: typeof def.description === 'string' ? def.description : '',
        multivalue: typeof def.multivalue === 'boolean' ? def.multivalue : false,
        validation,
        values: this.resolveValues(def.values || def.options),
        pattern: typeof def.pattern === 'string' ? def.pattern : undefined,
        required: typeof def.required === 'boolean' ? def.required : false,
        ui: uiRaw ? {
          kind: (TRAILER_UI_KINDS as readonly string[]).includes(uiRaw.kind as string) 
            ? uiRaw.kind as TrailerUiKind 
            : undefined,
          color: (TRAILER_UI_COLORS as readonly string[]).includes(uiRaw.color as string) 
            ? uiRaw.color as TrailerUiColor 
            : undefined,
        } : undefined,
      };
    }
    return result;
  }

  private resolveValues(valuesRaw: any): Record<string, ValueDefinition> | undefined {
    if (Array.isArray(valuesRaw)) {
      const result: Record<string, ValueDefinition> = {};
      for (const opt of valuesRaw) if (typeof opt === 'string') result[opt] = { description: '' };
      return result;
    }
    if (valuesRaw && typeof valuesRaw === 'object') {
      const result: Record<string, ValueDefinition> = {};
      for (const [key, value] of Object.entries(valuesRaw)) {
        if (typeof value === 'string') result[key] = { description: value };
        else if (value && typeof value === 'object') {
          result[key] = { description: typeof (value as any).description === 'string' ? (value as any).description : '' };
        }
      }
      return result;
    }
    return undefined;
  }
}
