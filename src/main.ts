import { runCli, execute } from './engine/index.js';
import { resolve } from 'node:path';
import { ENGINE_CONFIG_FILENAME, ENGINE_DIR_NAME } from './util/constants.js';
import { DEFAULT_ENGINE_CONFIG } from './engine/defaults.js';

/**
 * Agnostic Atom Engine CLI.
 */
async function main() {
  const options = {
    binaryName: 'atom',
    description: 'Agnostic Decision Engine for Git',
    engineDirName: ENGINE_DIR_NAME,
    configFileName: ENGINE_CONFIG_FILENAME,
    defaultConfig: DEFAULT_ENGINE_CONFIG,
    staticProtocols: [], // Atom starts with zero protocols by default
    packageJsonPath: resolve(new URL('../package.json', import.meta.url).pathname),
  };

  const { program, getFormatter, config } = await runCli(options);
  await execute(program, getFormatter, config);
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
