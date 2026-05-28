import { readdir, readFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { ProtocolDefinition } from '../interfaces/protocol-definition.js';
import type { CustomTrailerDefinition, ValueDefinition, TrailerUiKind, TrailerUiColor } from '../types/config.js';
import { TRAILER_UI_KINDS, TRAILER_UI_COLORS } from '../../util/constants.js';

/**
 * Dynamically loads protocol definitions from .atom/protocols/*.toml
 * 
 * SOLID: OCP -- allows adding new protocols without modifying the engine core.
 */
export class DynamicProtocolLoader {
  constructor(private readonly protocolsDir: string) {}

  /**
   * Scans the protocols directory and returns all found definitions.
   */
  async loadAll(): Promise<ProtocolDefinition[]> {
    try {
      const files = await readdir(this.protocolsDir);
      const tomlFiles = files.filter(f => extname(f) === '.toml');
      
      const results = await Promise.all(
        tomlFiles.map(file => this.loadFromFile(join(this.protocolsDir, file)))
      );

      return results.filter((def): def is ProtocolDefinition => def !== null);
    } catch {
      // Directory might not exist, return empty
      return [];
    }
  }

  /**
   * Loads a single protocol definition from a TOML file.
   */
  async loadFromFile(filePath: string): Promise<ProtocolDefinition | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const raw = parseToml(content) as any;
      const slug = basename(filePath, '.toml').toLowerCase();

      return {
        name: raw.name || basename(filePath, '.toml'),
        version: raw.version || '1.0',
        namespace: raw.namespace !== undefined ? raw.namespace : slug,
        identityKey: raw.identity_key || raw.identityKey || `${raw.name || slug}-id`,
        trailers: this.resolveDefinitions(raw.trailers || {}),
      };
    } catch {
      return null;
    }
  }

  /**
   * Shared logic to parse custom trailer definitions (shared with old config loader logic).
   */
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

      const directives = Array.isArray(def.directives)
        ? def.directives.filter((d: any): d is string => typeof d === 'string')
        : undefined;

      const uiRaw = typeof def.ui === 'object' && def.ui !== null ? def.ui : undefined;

      result[key] = {
        description: typeof def.description === 'string' ? def.description : '',
        multivalue: typeof def.multivalue === 'boolean' ? def.multivalue : false,
        validation,
        values: this.resolveValues(def.values || def.options),
        pattern: typeof def.pattern === 'string' ? def.pattern : undefined,
        required: typeof def.required === 'boolean' ? def.required : false,
        directives,
        ui: uiRaw ? {
          kind: (TRAILER_UI_KINDS as readonly string[]).includes(uiRaw.kind as string) 
            ? uiRaw.kind as TrailerUiKind 
            : undefined,
          color: (TRAILER_UI_COLORS as readonly string[]).includes(uiRaw.color as string) 
            ? uiRaw.color as TrailerUiColor 
            : undefined,
        } : undefined,
        cli: def.cli,
        prompt: def.prompt,
        squash: def.squash,
        generator: def.generator
      };
    }

    return result;
  }

  private resolveValues(valuesRaw: any): Record<string, ValueDefinition> | undefined {
    if (Array.isArray(valuesRaw)) {
      const result: Record<string, ValueDefinition> = {};
      for (const opt of valuesRaw) {
        if (typeof opt === 'string') {
          result[opt] = { description: '' };
        }
      }
      return result;
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
      return result;
    }

    return undefined;
  }
}
