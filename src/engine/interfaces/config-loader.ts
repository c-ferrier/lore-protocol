import type { Config } from '../types/config.js';

export interface IConfigLoader {
  loadForPath(targetPath: string): Promise<Config>;
  loadFromFile(configPath: string): Promise<Config>;
  findConfigPath(startPath: string): Promise<string | null>;
}
