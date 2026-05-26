import type { Command } from 'commander';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify as stringifyToml } from 'smol-toml';
import type { EngineConfig } from '../types/config.js';

/**
 * Register the generic `init` command for the Atom Engine.
 * Responsible for creating the .atom/ directory and initial config.toml
 */
export function registerInitCommand(
  program: Command,
  deps: {
    getFormatter: () => IOutputFormatter;
    engineDirName: string;
    configFileName: string;
    defaultConfig: EngineConfig;
  },
): void {
  program
    .command('init')
    .description('Initialize Atom Engine in repository')
    .action(async () => {
      const formatter = deps.getFormatter();
      const configDir = join(process.cwd(), deps.engineDirName);
      const configPath = join(configDir, deps.configFileName);

      // 1. Create .atom directory
      await mkdir(configDir, { recursive: true });

      // 2. Create .atom/protocols directory
      await mkdir(join(configDir, 'protocols'), { recursive: true });

      // 3. Write default config if missing
      if (!(await fileExists(configPath))) {
        // Convert camelCase config to snake_case for TOML
        const tomlData = serializeToToml(deps.defaultConfig);
        await writeFile(configPath, tomlData, 'utf-8');
        console.log(formatter.formatSuccess(`Created ${deps.engineDirName}/${deps.configFileName}`));
      } else {
        console.log(formatter.formatSuccess(`Config already exists at ${deps.engineDirName}/${deps.configFileName}`));
      }

      // 4. Ensure cache is ignored
      await ensureCacheIgnored(deps.getFormatter(), deps.engineDirName);
    });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureCacheIgnored(formatter: IOutputFormatter, engineDir: string): Promise<void> {
  const gitignorePath = join(process.cwd(), '.gitignore');
  const ignorePattern = `${engineDir}/cache`;
  
  let content = '';
  try {
    content = await readFile(gitignorePath, 'utf-8');
  } catch { /* ignore */ }

  if (!content.split('\n').map(l => l.trim()).includes(ignorePattern)) {
    const suffix = content === '' || content.endsWith('\n') ? '' : '\n';
    await writeFile(gitignorePath, `${content}${suffix}${ignorePattern}\n`, 'utf-8');
    console.log(formatter.formatSuccess(`Updated .gitignore to ignore ${ignorePattern}`));
  }
}

function serializeToToml(config: EngineConfig): string {
    // Simple serialization that handles camelCase -> snake_case for engine sections
    const output: any = {};
    for (const [section, data] of Object.entries(config)) {
        output[section] = {};
        for (const [key, value] of Object.entries(data as any)) {
            const snakeKey = key.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
            output[section][snakeKey] = value;
        }
    }
    return stringifyToml(output);
}
