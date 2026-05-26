export interface IConfigLoader<T = any> {
  loadForPath(targetPath: string): Promise<T>;
  loadFromFile(configPath: string): Promise<T>;
  findConfigPath(startPath: string): Promise<string | null>;
}
