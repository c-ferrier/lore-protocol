import type { Command } from 'commander';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify as stringifyToml, parse as parseToml } from 'smol-toml';
import { ENGINE_CONFIG_SCHEMA } from '../types/config.js';
import type { EngineConfig } from '../types/config.js';
import { analyzeConfigGaps } from '../util/config-analyzer.js';
import type { ILogger } from '../interfaces/logger.js';

export interface InitDeps {
  getFormatter: () => IOutputFormatter;
  engineDirName: string;
  configFileName: string;
  defaultConfig: EngineConfig;
  logger: ILogger;
}

/**
 * Shared logic to initialize the Atom Engine.
 * Responsible for creating the .atom/ directory and initial config.toml
 */
export async function executeEngineInit(deps: InitDeps): Promise<void> {
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
    deps.logger.info(formatter.formatSuccess(`Created ${deps.engineDirName}/${deps.configFileName}`));
  } else {
    deps.logger.info(formatter.formatSuccess(`Config already exists at ${deps.engineDirName}/${deps.configFileName}`));
    
    // Perform Gap Analysis for the Engine Config
    try {
        const content = await readFile(configPath, 'utf-8');
        const parsed = parseToml(content) as any;
        const { missing } = analyzeConfigGaps(parsed, ENGINE_CONFIG_SCHEMA, deps.defaultConfig);

        if (missing.length > 0) {
            deps.logger.info('\n' + formatter.formatSuccess('Your engine configuration is missing new options:'));
            for (const item of missing) {
                deps.logger.info(`  - ${item}`);
            }
        }
    } catch { /* ignore corruption in engine init, best effort */ }
  }

  // 4. Ensure cache is ignored
  await ensureCacheIgnored(deps);
}

/**
 * Register the generic `init` command for the Atom Engine.
 */
export function registerInitCommand(
  program: Command,
  deps: InitDeps,
): void {
  program
    .command('init')
    .description('Initialize Atom Engine in repository')
    .action(async () => {
      await executeEngineInit(deps);
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

async function ensureCacheIgnored(deps: InitDeps): Promise<void> {
  const formatter = deps.getFormatter();
  const gitignorePath = join(process.cwd(), '.gitignore');
  const ignorePattern = `${deps.engineDirName}/cache`;
  
  let content = '';
  try {
    content = await readFile(gitignorePath, 'utf-8');
  } catch {
    // File likely doesn't exist
  }

  const lines = (content || '').split('\n').map(l => l.trim());
  if (!lines.includes(ignorePattern)) {
    const suffix = !content || content.endsWith('\n') ? '' : '\n';
    const newContent = `${content}${suffix}${ignorePattern}\n`;
    await writeFile(gitignorePath, newContent, 'utf-8');
    deps.logger.info(formatter.formatSuccess(`Updated .gitignore to ignore ${ignorePattern}`));
  }
}

function serializeToToml(config: EngineConfig): string {
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
