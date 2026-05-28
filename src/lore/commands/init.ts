import type { Command } from 'commander';
import type { IOutputFormatter } from '../../engine/interfaces/output-formatter.js';
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { 
    LORE_CONFIG_DIR, 
    LORE_CONFIG_FILENAME, 
    LORE_050_CONFIG_TEMPLATE,
    LORE_050_EXPECTED_KEYS
} from '../defaults.js';
import { executeEngineInit } from '../../engine/commands/init.js';
import type { EngineConfig } from '../../engine/types/config.js';
import { LoreProtocolDefinition } from '../protocol-definition.js';
import { stringify as stringifyToml, parse as parseToml } from 'smol-toml';
import { ProtocolError } from '../../util/errors.js';
import { type ILogger, LogLevel } from '../../engine/interfaces/logger.js';
import { InMemoryLogger } from '../../engine/services/in-memory-logger.js';

/**
 * Lore-specific init command.
 * 
 * 1. Delegates core .atom setup to the Engine silently.
 * 2. Writes lore.toml to .atom/protocols/ (Dynamic Discovery).
 * 3. Creates legacy .lore/config.toml (0.5.0 parity) from template.
 * 4. Performs gap detection using a specialized 0.5.0 spec.
 */
export function registerInitCommand(
  program: Command,
  deps: {
    getFormatter: () => IOutputFormatter;
    engineDirName: string;
    configFileName: string;
    defaultConfig: EngineConfig;
    logger: ILogger;
  },
): void {
  const { getFormatter, engineDirName, logger } = deps;

  // Helper to run engine init silently so users don't see .atom paths
  const runEngineSilent = async () => {
    const silentLogger = new InMemoryLogger();
    try {
      await executeEngineInit({ ...deps, logger: silentLogger });
    } catch (err) {
      // If engine init fails, dump the silent logs so we can debug
      for (const log of silentLogger.logs) {
        if (log.level === LogLevel.ERROR) logger.error(log.message);
        else if (log.level === LogLevel.WARN) logger.warn(log.message);
        else logger.info(log.message);
      }
      throw err;
    }
  };

  program
    .command('init')
    .description('Initialize .lore/ config in repository')
    .action(async () => {
      const formatter = getFormatter();
      const loreDir = join(process.cwd(), LORE_CONFIG_DIR);
      const lorePath = join(loreDir, LORE_CONFIG_FILENAME);

      // --- GAP DETECTION & REPORTING ---
      if (await fileExists(lorePath)) {
        const content = await readFile(lorePath, 'utf-8');
        logger.info(formatter.formatSuccess(`Config already exists at ${LORE_CONFIG_DIR}/${LORE_CONFIG_FILENAME}:`));
        
        try {
          const parsed = parseToml(content) as any;
          const { missing, customized } = findConfigDiff(parsed);

          if (missing.length > 0) {
            logger.info('\n' + formatter.formatSuccess('Your configuration is missing new options:'));
            for (const item of missing) logger.info(`  - ${item}`);

            if (customized.length === 0) {
              logger.info('\nNotice: You are using default settings. You can safely reset your config to get the latest options.');
              logger.info(`Example: rm ${LORE_CONFIG_DIR}/${LORE_CONFIG_FILENAME} && lore init`);
            } else {
              logger.info('\nNotice: You have customized some options. To update, rename your current config and manually merge changes.');
            }
          }
        } catch (err) {
          throw new ProtocolError(`Your configuration file is corrupted: ${err instanceof Error ? err.message : String(err)}`, 1);
        }

        // Even if config exists, ensure engine backing is present silently
        await runEngineSilent();
        await writeDiscoveryProtocol(engineDirName, formatter, logger);
        return;
      }

      // --- INITIALIZATION ---
      // 1. Delegate core engine setup silently
      await runEngineSilent();

      // 2. Write protocol definition for Atom's dynamic discovery
      await writeDiscoveryProtocol(engineDirName, formatter, logger);

      // 3. Legacy Lore Setup (.lore/config.toml) from 0.5.0 template
      await mkdir(loreDir, { recursive: true });
      await writeFile(lorePath, LORE_050_CONFIG_TEMPLATE, 'utf-8');
      logger.info(formatter.formatSuccess(`Created ${LORE_CONFIG_DIR}/${LORE_CONFIG_FILENAME} (0.5.0 parity)`));
    });
}

async function writeDiscoveryProtocol(engineDirName: string, formatter: IOutputFormatter, logger: ILogger): Promise<void> {
    const protocolsDir = join(process.cwd(), engineDirName, 'protocols');
    const loreProtocolPath = join(protocolsDir, 'lore.toml');
    
    await mkdir(protocolsDir, { recursive: true });
    if (!(await fileExists(loreProtocolPath))) {
        const protocolContent = serializeProtocol(LoreProtocolDefinition);
        await writeFile(loreProtocolPath, protocolContent, 'utf-8');
        logger.info(formatter.formatSuccess(`Created ${engineDirName}/protocols/lore.toml (Discovery)`));
    }
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Diffs a parsed TOML config against the literal LORE_050_EXPECTED_KEYS spec.
 */
function findConfigDiff(parsed: Record<string, unknown>): { missing: string[]; customized: string[] } {
  const missing: string[] = [];
  const customized: string[] = [];

  // Parse the template to get default values for customization check
  const templateDefaults = parseToml(LORE_050_CONFIG_TEMPLATE) as any;

  for (const [section, keys] of Object.entries(LORE_050_EXPECTED_KEYS)) {
    const userSection = parsed[section] as Record<string, unknown> | undefined;
    const defaultSection = templateDefaults[section] || {};

    if (!userSection || typeof userSection !== 'object') {
      missing.push(`[${section}] section`);
      continue;
    }

    for (const key of keys) {
      const userValue = (userSection as any)[key];
      const defaultValue = (defaultSection as any)[key];

      if (userValue === undefined) {
        missing.push(`${section}.${key}`);
      } else if (JSON.stringify(userValue) !== JSON.stringify(defaultValue)) {
        customized.push(`${section}.${key}`);
      }
    }
  }

  return { missing, customized };
}

/**
 * Serialize a ProtocolDefinition to TOML for dynamic discovery.
 */
function serializeProtocol(def: any): string {
    const output = {
        name: def.name,
        version: def.version,
        namespace: def.namespace,
        identity_key: def.identityKey,
        trailers: {} as any
    };
    for (const [key, t] of Object.entries(def.trailers)) {
        const trailer: any = { ...(t as any) };
        if (trailer.ui) delete trailer.ui;
        if (trailer.prompt) delete trailer.prompt;
        if (trailer.directives) delete trailer.directives;
        output.trailers[key] = trailer;
    }
    return stringifyToml(output);
}
