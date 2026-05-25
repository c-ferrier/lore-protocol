import type { Command } from 'commander';
import type { IOutputFormatter } from '../engine/interfaces/output-formatter.js';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { LORE_CONFIG_DIR, LORE_CONFIG_FILENAME, LORE_DEFAULT_CONFIG } from '../defaults.js';
import { ProtocolError } from '../../util/errors.js';
import type { Config } from '../engine/types/config.js';

export function registerInitCommand(
  program: Command,
  deps: {
    getFormatter: () => IOutputFormatter;
    protocolName: string;
  },
): void {
  const { protocolName } = deps;
  const defaultContent = `[protocol]
version = "1.0"

[trailers]
# If true, all unknown trailers are preserved. If false, only defined/custom are kept.
permissive = true
required = []
custom = []

# Define custom trailer rules here
# [trailers.definitions.Department]
# description = "The department responsible"
# multivalue = false
# validation = "options"
# options = ["Engineering", "Product", "Design"]
# required = true

[validation]
strict = false
max_message_lines = 50
intent_max_length = 72

[stale]
older_than = "6m"
drift_threshold = 20

[output]
default_format = "text"

[follow]
max_depth = 3

[cli]
update_check = true
`;

  program
    .command('init')
    .description(`Initialize .${protocolName.toLowerCase()}/ config in repository`)
    .action(async () => {
      const formatter = deps.getFormatter();
      const configDir = join(process.cwd(), LORE_CONFIG_DIR);
      const configPath = join(configDir, LORE_CONFIG_FILENAME);

      // Check if config already exists
      let exists = false;
      try {
        await access(configPath);
        exists = true;
      } catch {
        // File does not exist
      }

      if (exists) {
        const content = await readFile(configPath, 'utf-8');
        console.log(formatter.formatSuccess(
          `Config already exists at ${LORE_CONFIG_DIR}/${LORE_CONFIG_FILENAME}:`,
        ));
        console.log(content);

        let parsed: Record<string, unknown>;
        try {
          parsed = parseToml(content) as Record<string, unknown>;
        } catch (err) {
          const message = `Your configuration file is corrupted and cannot be parsed: ${err instanceof Error ? err.message : String(err)}\n\nPlease fix the TOML syntax or reset your config.\nExample: mv ${LORE_CONFIG_DIR}/${LORE_CONFIG_FILENAME} ${LORE_CONFIG_DIR}/${LORE_CONFIG_FILENAME}.corrupted && lore init`;
          throw new ProtocolError(message, 1);
        }

        const { missing, customized } = findConfigDiff(parsed);

        if (missing.length > 0) {
          console.log('\n' + formatter.formatSuccess(
            'Your configuration is missing new options:',
          ));
          for (const item of missing) {
            console.log(`  - ${item}`);
          }

          if (customized.length === 0) {
            console.log('\nNotice: You are using default settings. You can safely reset your config to get the latest options.');
            console.log(`Example: rm ${LORE_CONFIG_DIR}/${LORE_CONFIG_FILENAME} && lore init`);
          } else {
            console.log('\nNotice: You have customized the following options:');
            for (const item of customized) {
              console.log(`  - ${item}`);
            }
            console.log('\nTo update: Rename your current config, run \`lore init\` again, and manually merge your changes.');
            console.log(`Example: mv ${LORE_CONFIG_DIR}/${LORE_CONFIG_FILENAME} ${LORE_CONFIG_DIR}/${LORE_CONFIG_FILENAME}.bak && lore init`);
          }
        }
        
        // Ensure cache is ignored even if config already exists
        await ensureCacheIgnored(formatter);
        return;
      }

      // Create directory and write config
      await mkdir(configDir, { recursive: true });
      await writeFile(configPath, defaultContent, 'utf-8');

      console.log(formatter.formatSuccess(
        `Created ${LORE_CONFIG_DIR}/${LORE_CONFIG_FILENAME} with protocol version 1.0`,
      ));

      // Ensure cache is ignored
      await ensureCacheIgnored(formatter);
    });
}

/**
 * Ensures that .lore/cache is added to the .gitignore in the current directory.
 * Uses process.cwd() to match where `lore init` creates .lore/config.toml.
 * Idempotent: does nothing if the pattern is already present.
 */
async function ensureCacheIgnored(formatter: IOutputFormatter): Promise<void> {
  const gitignorePath = join(process.cwd(), '.gitignore');
  const ignorePattern = '.lore/cache';
  let content = '';
  let exists = false;

  try {
    content = await readFile(gitignorePath, 'utf-8');
    exists = true;
  } catch {
    // File does not exist
  }

  const lines = content.split('\n').map((l) => l.trim());
  if (lines.includes(ignorePattern)) {
    return;
  }

  const suffix = content === '' || content.endsWith('\n') ? '' : '\n';
  const newContent = `${content}${suffix}${ignorePattern}\n`;

  await writeFile(gitignorePath, newContent, 'utf-8');

  if (exists) {
    console.log(formatter.formatSuccess(`Updated .gitignore to ignore ${ignorePattern}`));
  } else {
    console.log(formatter.formatSuccess(`Created .gitignore to ignore ${ignorePattern}`));
  }
}

function findConfigDiff(parsed: Record<string, unknown>): { missing: string[]; customized: string[] } {
  const missing: string[] = [];
  const customized: string[] = [];

  const configKeys = Object.keys(LORE_DEFAULT_CONFIG) as (keyof Config)[];

  for (const section of configKeys) {
    const defaults = LORE_DEFAULT_CONFIG[section] as Record<string, unknown>;
    const userSection = parsed[section];

    if (!userSection || typeof userSection !== 'object') {
      missing.push(`[${section}] section`);
      continue;
    }

    const sectionData = userSection as Record<string, unknown>;
    for (const [key, defaultValue] of Object.entries(defaults)) {
      // Skip the definitions dictionary as it's meant to be user-extensible
      if (section === 'trailers' && key === 'definitions') continue;

      // Convert camelCase from Config type to snake_case for TOML comparison
      const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      const userValue = sectionData[snakeKey] ?? sectionData[key];

      if (userValue === undefined) {
        missing.push(`${section}.${snakeKey}`);
      } else if (JSON.stringify(userValue) !== JSON.stringify(defaultValue)) {
        customized.push(`${section}.${snakeKey}`);
      }
    }
  }

  return { missing, customized };
}
