import { TerminalPrompt } from './cli/io/terminal-prompt.js';
import { checkForUpdates } from './core/logic/update-check.js';
import { getEnginePackageName, getEnginePublishedVersion,getEngineVersion } from './core/logic/version.js';
import { DEFAULT_ENGINE_CONFIG } from './defaults.js';
import { 
    execute,
    registerCacheCommand,
    registerCommitCommand,
    registerConfigCommand,
    registerDoctorCommand,
    registerLogCommand,
    registerSquashCommand,
    registerStaleCommand,
    registerTraceCommand,
    registerValidateCommand,
    runCli,
    SYSTEM_PROTOCOL
} from './index.js';
import { ENGINE_CONFIG_FILENAME, ENGINE_DIR_NAME } from './util/constants.js';

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
    prompt: new TerminalPrompt(),
  };

  const { program, getFormatter, config, infra } = await runCli(options);
  
  // 8. Register Commands
  registerLogCommand(program, infra);
  registerStaleCommand(program, infra);
  registerTraceCommand(program, infra, SYSTEM_PROTOCOL);
  registerCommitCommand(program, infra);
  registerValidateCommand(program, infra);
  registerSquashCommand(program, infra);
  registerCacheCommand(program, infra);
  registerConfigCommand(program, infra);
  registerDoctorCommand(program, infra);

  // Non-blocking update check for the core engine
  checkForUpdates({
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
