import { checkForUpdates } from './engine/core/logic/update-check.js';
import { getEnginePackageName, getEnginePublishedVersion,getEngineVersion } from './engine/core/logic/version.js';
import { DEFAULT_ENGINE_CONFIG } from './engine/defaults.js';
import { execute,runCli } from './engine/index.js';
import { ENGINE_CONFIG_FILENAME, ENGINE_DIR_NAME } from './engine/util/constants.js';

/**
 * Agnostic Atom Engine CLI.
 */
async function main() {
  const options = {
    binaryName: 'atom',
    version: getEngineVersion(),
    description: 'Agnostic Decision Engine for Git',
    engineDirName: ENGINE_DIR_NAME,
    configFileName: ENGINE_CONFIG_FILENAME,
    defaultConfig: DEFAULT_ENGINE_CONFIG,
    staticProtocols: [], // Atom starts with zero protocols by default
  };

  const { program, getFormatter, config } = await runCli(options);
  
  // Non-blocking update check for the core engine
  void checkForUpdates({
    packageName: getEnginePackageName(), 
    currentVersion: getEnginePublishedVersion(),
    configEnabled: config.cli.updateCheck
  });

  await execute(program, getFormatter);
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
