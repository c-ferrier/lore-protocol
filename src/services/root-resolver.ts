import { join, dirname } from 'node:path';
import type { IConfigLoader } from '../interfaces/config-loader.js';
import type { IGitClient } from '../interfaces/git-client.js';

export interface LoreRoots {
  readonly loreRoot: string;
  readonly gitRoot: string | null;
}

/**
 * Resolves the root directory for Lore operations.
 * 
 * Logic:
 * 1. Walk up from CWD to find nearest .lore directory.
 * 2. If not found, try to find the git repository root.
 * 3. Fallback to process.cwd().
 */
export async function resolveLoreRoot(
  cwd: string,
  configLoader: IConfigLoader,
  gitClient: IGitClient,
): Promise<LoreRoots> {
  let loreRoot = cwd;
  let gitRoot: string | null = null;

  try {
    if (await gitClient.isInsideRepo()) {
      gitRoot = await gitClient.getRepoRoot();
    }

    const configPath = await configLoader.findConfigPath(cwd);
    if (configPath) {
      loreRoot = dirname(dirname(configPath));
    } else if (gitRoot) {
      loreRoot = gitRoot;
    }
  } catch {
    // Best-effort
  }

  return { loreRoot, gitRoot };
}
