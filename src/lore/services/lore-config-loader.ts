import { readFile, access } from 'node:fs/promises';
import { parse as parseToml } from 'smol-toml';
import type { LoreConfig } from '../defaults.js';

/**
 * Responsibility: Parse .lore/config.toml and return the raw data structure.
 * 
 * SOLID: SRP -- Only parses the file. Does NOT translate to EngineConfig.
 */
export class LoreConfigLoader {
  constructor(private readonly configPath: string) {}

  /**
   * Loads the legacy config and returns the raw parsed data.
   */
  async load(): Promise<LoreConfig | null> {
    try {
      if (!(await this.exists())) return null;

      const content = await readFile(this.configPath, 'utf-8');
      return parseToml(content) as LoreConfig;
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
}
