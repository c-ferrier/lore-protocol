import { readdir, readFile, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { ProtocolDefinition } from '../interfaces/protocol-definition.js';
import type { TrailerDefinition } from '../types/config.js';
import { ProtocolHydrator } from './protocol-hydrator.js';
import { ConfigurationError } from '../util/errors.js';

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
    if (!(await this.dirExists())) {
        return [];
    }

    const files = await readdir(this.protocolsDir);
    const tomlFiles = files.filter(f => extname(f) === '.toml');
    
    return Promise.all(
        tomlFiles.map(file => this.loadFromFile(join(this.protocolsDir, file)))
    );
  }

  /**
   * Loads a single protocol definition from a TOML file.
   */
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
        strict: raw.strict !== undefined ? raw.strict : false,
        permissive: raw.permissive !== undefined ? raw.permissive : true,
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

  /**
   * Hydrate trailers using the shared ProtocolHydrator.
   */
  private hydrateTrailers(rawData: Record<string, any>): Record<string, TrailerDefinition> {
    const result: Record<string, TrailerDefinition> = {};
    for (const [key, value] of Object.entries(rawData)) {
      result[key] = ProtocolHydrator.hydrateTrailer(key, value);
    }
    return result;
  }
}
