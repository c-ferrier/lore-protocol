import { runCli, execute } from './engine/index.js';
import { resolve } from 'node:path';
import { DEFAULT_CACHE_PRUNE_THRESHOLD } from './util/constants.js';
import type { EngineConfig } from './engine/types/config.js';

const ATOM_DEFAULT_CONFIG: EngineConfig = {
  validation: { strict: false, maxMessageLines: 50, subjectMaxLength: 72 },
  stale: { olderThan: '6m', driftThreshold: 20 },
  output: { defaultFormat: 'text' },
  follow: { maxDepth: 3 },
  cli: { 
    updateCheck: true, 
    cache: true, 
    queryCache: true,
    queryCachePruneThreshold: DEFAULT_CACHE_PRUNE_THRESHOLD,
  },
};

/**
 * Agnostic Atom Engine CLI.
 */
async function main() {
  const options = {
    binaryName: 'atom',
    description: 'Agnostic Decision Engine for Git',
    engineDirName: '.atom',
    configFileName: 'config.toml',
    defaultConfig: ATOM_DEFAULT_CONFIG,
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
