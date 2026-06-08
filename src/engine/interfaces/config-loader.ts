export interface IConfigLoader<T = unknown> {
  loadForPath(targetPath: string): Promise<T>;
  loadFromFile(configPath: string): Promise<T>;
  findConfigPath(startPath: string): Promise<string | null>;
}
