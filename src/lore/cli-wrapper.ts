import { runCli, execute } from '../engine/index.js';
import { LoreProtocolDefinition } from './protocol-definition.js';
import { LORE_DEFAULT_CONFIG, LORE_CONFIG_DIR, LORE_CONFIG_FILENAME } from './defaults.js';
import { registerInitCommand } from './commands/init.js';
import { registerContextCommand } from './commands/context.js';
import { registerConstraintsCommand } from './commands/constraints.js';
import { registerDirectivesCommand } from './commands/directives.js';
import { registerTestedCommand } from './commands/tested.js';
import { registerRejectedCommand } from './commands/rejected.js';
import { resolve } from 'node:path';

/**
 * Lore CLI Compatibility Layer.
 * Wraps the agnostic Atom engine with Lore-specific commands and configuration.
 */
export async function runLore() {
  const options = {
    binaryName: 'lore',
    description: 'Structured decision context in git commits',
    configDirName: LORE_CONFIG_DIR,
    configFileName: LORE_CONFIG_FILENAME,
    defaultConfig: LORE_DEFAULT_CONFIG,
    protocols: [LoreProtocolDefinition],
    packageJsonPath: resolve(new URL('../../package.json', import.meta.url).pathname),
  };

  const { program, getFormatter, sharedDeps, config } = await runCli(options);

  // Register Lore-specific commands
  registerInitCommand(program, { 
    getFormatter, 
    protocolName: LoreProtocolDefinition.name 
  });

  registerContextCommand(program, sharedDeps);
  registerConstraintsCommand(program, sharedDeps);
  registerDirectivesCommand(program, sharedDeps);
  registerTestedCommand(program, sharedDeps);
  registerRejectedCommand(program, sharedDeps);

  // Execute the CLI
  await execute(program, getFormatter, config);
}
