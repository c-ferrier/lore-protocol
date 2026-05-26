import type { Command } from 'commander';
import type { IOutputFormatter } from '../../engine/interfaces/output-formatter.js';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { LORE_CONFIG_DIR, LORE_CONFIG_FILENAME } from '../defaults.js';
import { registerInitCommand as registerEngineInit } from '../../engine/commands/init.js';
import type { EngineConfig } from '../../engine/types/config.js';

/**
 * Lore-specific init command.
 * 
 * 1. Delegates core .atom setup to the Engine.
 * 2. Creates legacy .lore/config.toml for 0.5.0 parity.
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
  const { getFormatter, engineDirName, configFileName, defaultConfig } = deps;

  program
    .command('init')
    .description('Initialize Lore protocol and Atom Engine in repository')
    .action(async () => {
      const formatter = getFormatter();

      // 1. Core Engine Setup (.atom/)
      const engineInitAction = async () => {
          const configDir = join(process.cwd(), engineDirName);
          const configPath = join(configDir, configFileName);
          await mkdir(configDir, { recursive: true });
          await mkdir(join(configDir, 'protocols'), { recursive: true });
          
          if (!(await fileExists(configPath))) {
              // Write a simple engine config
              await writeFile(configPath, `[cli]\nupdate_check = true\ncache = true\n`, 'utf-8');
              console.log(formatter.formatSuccess(`Created ${engineDirName}/${configFileName}`));
          }
      };
      await engineInitAction();

      // 2. Legacy Lore Setup (.lore/)
      const loreDir = join(process.cwd(), LORE_CONFIG_DIR);
      const lorePath = join(loreDir, LORE_CONFIG_FILENAME);

      await mkdir(loreDir, { recursive: true });
      if (!(await fileExists(lorePath))) {
          const legacyContent = `[protocol]
version = "1.0"

[trailers]
permissive = true
required = []
custom = []

[validation]
strict = false
max_message_lines = 50
intent_max_length = 72

[stale]
older_than = "6m"
drift_threshold = 20

[output]
default_format = "text"
`;
          await writeFile(lorePath, legacyContent, 'utf-8');
          console.log(formatter.formatSuccess(`Created ${LORE_CONFIG_DIR}/${LORE_CONFIG_FILENAME} (0.5.0 parity)`));
      } else {
          console.log(formatter.formatSuccess(`Legacy config already exists at ${LORE_CONFIG_DIR}/${LORE_CONFIG_FILENAME}`));
      }

      // 3. Gitignore (Idempotent)
      await ensureIgnored(formatter, [
          `${engineDirName}/cache`,
          `${LORE_CONFIG_DIR}/cache`
      ]);
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

async function ensureIgnored(formatter: IOutputFormatter, patterns: string[]): Promise<void> {
    const gitignorePath = join(process.cwd(), '.gitignore');
    let content = '';
    try {
        const buf = await access(gitignorePath).then(() => true).catch(() => false);
        if (buf) {
            const raw = await import('node:fs').then(fs => fs.readFileSync(gitignorePath, 'utf-8'));
            content = raw;
        }
    } catch { /* ignore */ }

    const lines = content.split('\n').map(l => l.trim());
    let updated = false;

    for (const pattern of patterns) {
        if (!lines.includes(pattern)) {
            const suffix = content === '' || content.endsWith('\n') ? '' : '\n';
            content += `${suffix}${pattern}\n`;
            updated = true;
            console.log(formatter.formatSuccess(`Updated .gitignore to ignore ${pattern}`));
        }
    }

    if (updated) {
        await writeFile(gitignorePath, content, 'utf-8');
    }
}
