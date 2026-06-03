import { readFile, access, stat } from 'node:fs/promises';
import { join, dirname, resolve, parse as parsePath } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { IConfigLoader } from '../interfaces/config-loader.js';
import type { EngineConfig } from '../types/config.js';

type ConfigSection = keyof EngineConfig;

/**
 * Maps camelCase config keys to their TOML snake_case equivalents per section.
 */
const CAMEL_TO_SNAKE: Record<string, Record<string, string>> = {
  validation: {
    maxMessageLines: 'max_message_lines',
    subjectMaxLength: 'subject_max_length',
  },
  stale: {
    olderThan: 'older_than',
    driftThreshold: 'drift_threshold',
  },
  output: {
    defaultFormat: 'default_format',
  },
  follow: {
    maxDepth: 'max_depth',
  },
  cli: {
    updateCheck: 'update_check',
    cache: 'cache',
    queryCache: 'query_cache',
    queryCachePruneThreshold: 'query_cache_prune_threshold',
  },
};

const VALID_OUTPUT_FORMATS = new Set(['text', 'json']);

/**
 * Host-level configuration loader for the Atom Engine.
 * Loads engine settings from .atom/config.toml
 */
export class EngineConfigLoader implements IConfigLoader<EngineConfig> {
  constructor(
    private readonly configDir: string,
    private readonly configFilename: string,
    private readonly defaultConfig: EngineConfig,
  ) {}

  async loadForPath(targetPath: string): Promise<EngineConfig> {
    const configPaths = await this.walkConfigPaths(resolve(targetPath));

    if (configPaths.length === 0) {
      return { ...this.defaultConfig };
    }

    // Merge parent-first so child overrides parent
    let merged: Record<string, unknown> = {};
    for (const configPath of [...configPaths].reverse()) {
      const parsed = await this.parseConfigFile(configPath);
      merged = { ...merged, ...parsed };
    }

    return this.buildConfig(merged);
  }

  async loadFromFile(configPath: string): Promise<EngineConfig> {
    const parsed = await this.parseConfigFile(configPath);
    return this.buildConfig(parsed);
  }

  async findConfigPath(startPath: string): Promise<string | null> {
    const paths = await this.walkConfigPaths(resolve(startPath), true);
    return paths[0] ?? null;
  }

  private async walkConfigPaths(startPath: string, stopAtFirst = false): Promise<string[]> {
    const paths: string[] = [];
    let dir = resolve(startPath);
    
    // Resolve to directory if startPath is a file
    try {
      const s = await stat(dir);
      if (s.isFile()) dir = dirname(dir);
    } catch { /* best effort */ }

    const root = parsePath(dir).root;

    while (true) {
      const configPath = join(dir, this.configDir, this.configFilename);
      if (await this.fileExists(configPath)) {
        paths.push(configPath);
        if (stopAtFirst) return paths;
      }

      if (await this.fileExists(join(dir, '.git'))) break;

      const parentDir = dirname(dir);
      if (parentDir === dir || dir === root) break;
      dir = parentDir;
    }

    return paths;
  }

  private async parseConfigFile(configPath: string): Promise<Record<string, unknown>> {
    const content = await readFile(configPath, 'utf-8');
    return parseToml(content) as Record<string, unknown>;
  }

  private buildConfig(parsed: Record<string, unknown>): EngineConfig {
    const sections = Object.keys(this.defaultConfig) as ConfigSection[];
    const result: Record<string, unknown> = {};

    for (const section of sections) {
      const rawSection = parsed[section];

      // Pass-through Logic: Protocols are dynamic and not checked against defaults
      if (section === 'protocols') {
          result[section] = (rawSection && typeof rawSection === 'object') ? rawSection : {};
          continue;
      }

      if (!rawSection || typeof rawSection !== 'object') {
        result[section] = this.defaultConfig[section];
        continue;
      }

      const sectionData = rawSection as Record<string, unknown>;
      const defaults = this.defaultConfig[section] as Record<string, unknown>;
      const aliases = CAMEL_TO_SNAKE[section] ?? {};
      const built: Record<string, unknown> = {};

      for (const [key, defaultValue] of Object.entries(defaults)) {
        built[key] = this.resolveFieldValue(sectionData, key, aliases[key], defaultValue);
      }

      if (section === 'output' && !VALID_OUTPUT_FORMATS.has(built['defaultFormat'] as string)) {
        built['defaultFormat'] = this.defaultConfig.output.defaultFormat;
      }

      result[section] = built;
    }

    return result as unknown as EngineConfig;
  }

  private resolveFieldValue(
    sectionData: Record<string, unknown>,
    camelKey: string,
    snakeKey: string | undefined,
    defaultValue: unknown,
  ): unknown {
    const rawValue = (snakeKey ? sectionData[snakeKey] : undefined) ?? sectionData[camelKey];

    if (rawValue === undefined) return defaultValue;
    if (Array.isArray(defaultValue)) return Array.isArray(rawValue) ? rawValue : defaultValue;
    return typeof rawValue === typeof defaultValue ? rawValue : defaultValue;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
