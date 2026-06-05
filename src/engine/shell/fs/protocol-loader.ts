import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname,join } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import type { EngineConfig, TrailerDefinition } from '../../core/types/config.js';
import type { ProtocolDefinition } from '../../core/types/protocol-definition.js';
import { ConfigurationError } from '../../util/errors.js';
import { ProtocolHydrator } from './protocol-hydrator.js';

/**
 * Dynamically loads protocol definitions from .atom/protocols/*.toml
 */
export class DynamicProtocolLoader {
  constructor(private readonly protocolsDir: string) {}

  async loadAll(): Promise<ProtocolDefinition[]> {
    if (!(await this.dirExists())) return [];
    const files = await readdir(this.protocolsDir);
    const tomlFiles = files.filter(f => extname(f) === '.toml');
    return Promise.all(tomlFiles.map(file => this.loadFromFile(join(this.protocolsDir, file))));
  }

  async loadFromFile(filePath: string): Promise<ProtocolDefinition> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const raw = parseToml(content) as any;
      const slug = basename(filePath, '.toml').toLowerCase();

      return {
        name: raw.name || basename(filePath, '.toml'),
        version: raw.version || '1.0',
        namespace: raw.namespace !== undefined ? raw.namespace : slug,
        identityKey: raw.identity_key || raw.identityKey || `${raw.name || slug}-id`,
        strict: raw.strict !== undefined ? raw.strict : true, // Strict by default
        permissive: raw.permissive !== undefined ? raw.permissive : false, // False by default
        trailers: this.hydrateTrailers(raw.trailers || {}),
      };
    } catch (err: any) {
      throw new ConfigurationError(`Failed to load protocol from "${filePath}": ${err.message}`);
    }
  }

  private async dirExists(): Promise<boolean> {
      try {
          const s = await stat(this.protocolsDir);
          return s.isDirectory();
      } catch {
          return false;
      }
  }

  private hydrateTrailers(rawData: Record<string, any>): Record<string, TrailerDefinition> {
    const result: Record<string, TrailerDefinition> = {};
    for (const [key, value] of Object.entries(rawData)) {
      result[key] = ProtocolHydrator.hydrateTrailer(key, value);
    }
    return result;
  }
}

/**
 * Higher-level orchestrator that combines static and dynamic protocol definitions.
 */
export class ProtocolLoader {
  constructor(
    private readonly dynamicLoader: DynamicProtocolLoader,
    private readonly staticProtocols: ProtocolDefinition[] = [],
  ) {}

  async loadAll(config: EngineConfig): Promise<ProtocolDefinition[]> {
    const dynamic = await this.dynamicLoader.loadAll();
    
    // Merge: Dynamic definitions enhance static ones (preserving static logic hooks)
    const staticMap = new Map<string, ProtocolDefinition>();
    for (const s of this.staticProtocols) {
        staticMap.set(s.name.toLowerCase(), s);
    }

    const mergedMap = new Map<string, ProtocolDefinition>();
    for (const d of dynamic) {
        const dName = d.name.toLowerCase();
        
        if (mergedMap.has(dName)) {
            throw new ConfigurationError(`Duplicate protocol definition found for "${d.name}". Ensure all protocol names are unique.`);
        }

        // Ensure hydration even for mocked dynamic loaders
        const hydratedD = {
            ...d,
            trailers: this.hydrateTrailers(d.trailers || {})
        };

        const base = staticMap.get(dName);
        if (base) {
            // Merge dynamic into static
            const mergedTrailers = { ...base.trailers };
            for (const [key, def] of Object.entries(hydratedD.trailers)) {
                mergedTrailers[key] = { ...(mergedTrailers[key] || {}), ...def };
            }
            mergedMap.set(dName, {
                ...base,
                ...hydratedD,
                trailers: mergedTrailers,
            });
        } else {
            mergedMap.set(dName, hydratedD);
        }
    }

    // Add remaining statics
    for (const s of this.staticProtocols) {
        const sName = s.name.toLowerCase();
        if (!mergedMap.has(sName)) {
            // Ensure hydration for static ones too (just in case)
            mergedMap.set(sName, {
                ...s,
                trailers: this.hydrateTrailers(s.trailers || {})
            });
        }
    }
    
    const all = Array.from(mergedMap.values());
    return ProtocolLoader.applyOverrides(all, config.protocols);
  }

  static applyOverrides(
    defs: ProtocolDefinition[],
    overrides: Record<string, Partial<ProtocolDefinition>> = {},
  ): ProtocolDefinition[] {
    return defs.map((def) => {
      const override = overrides[def.name] || overrides[def.name.toLowerCase()];
      if (!override) return def;

      const mergedTrailers = { ...def.trailers };
      if (override.trailers) {
        for (const [key, trailerOverride] of Object.entries(override.trailers)) {
          const hydratedOverride = ProtocolHydrator.hydrateTrailer(key, trailerOverride);
          
          if (mergedTrailers[key]) {
            mergedTrailers[key] = {
              ...mergedTrailers[key],
              ...hydratedOverride,
            };
          } else {
            mergedTrailers[key] = hydratedOverride;
          }
        }
      }

      return {
        ...def,
        ...override,
        trailers: mergedTrailers,
      };
    });
  }

  private hydrateTrailers(rawData: Record<string, any>): Record<string, TrailerDefinition> {
    const result: Record<string, TrailerDefinition> = {};
    for (const [key, value] of Object.entries(rawData)) {
      result[key] = ProtocolHydrator.hydrateTrailer(key, value);
    }
    return result;
  }
}
