import { readFile, access } from 'node:fs/promises';
import { parse as parseToml } from 'smol-toml';

export interface Lore050Config {
  protocol?: {
    version?: string;
  };
  trailers?: {
    required?: string[];
    custom?: string[];
    definitions?: Record<string, any>;
    permissive?: boolean;
  };
  validation?: {
    strict?: boolean;
    max_message_lines?: number;
    intent_max_length?: number;
    subject_max_length?: number;
  };
  stale?: {
    older_than?: string;
    drift_threshold?: number;
  };
  output?: {
    default_format?: 'text' | 'json';
  };
  cli?: {
    update_check?: boolean;
    cache?: boolean;
  };
}

/**
 * Responsibility: Parse .lore/config.toml and return the raw data structure.
 * 
 * SOLID: SRP -- Only parses the file. Does NOT translate to EngineConfig.
 */
export class LoreLegacyLoader {
  constructor(private readonly configPath: string) {}

  /**
   * Loads the legacy config and returns the raw parsed data.
   */
  async load(): Promise<Lore050Config | null> {
    try {
      if (!(await this.exists())) return null;

      const content = await readFile(this.configPath, 'utf-8');
      return parseToml(content) as Lore050Config;
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
