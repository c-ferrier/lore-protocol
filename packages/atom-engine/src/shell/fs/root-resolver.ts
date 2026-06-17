import { dirname } from 'node:path';

import type { IConfigLoader } from '../../interfaces/config-loader.js';
import type { IGitClient } from '../../interfaces/git-client.js';

export interface ProtocolRoots {
  readonly protocolRoot: string;
  readonly isScoped: boolean;
}

/**
 * Resolves the root directory for protocol operations.
 * 
 * Logic:
 * 1. Walk up from CWD to find nearest protocol directory (using configLoader's knowledge of dirName).
 * 2. If not found, try to find the git repository root.
 * 3. Fallback to process.cwd().
 * 4. Determine isScoped: True if protocolRoot is a subdirectory of gitRoot.
 */
export async function resolveProtocolRoot(
  cwd: string,
  configLoader: IConfigLoader<unknown>,
  gitClient: IGitClient,
): Promise<ProtocolRoots> {
  let protocolRoot = cwd;
  let gitRoot: string | null = null;

  try {
    if (await gitClient.isInsideRepo()) {
      gitRoot = await gitClient.getRepoRoot();
    }

    const configPath = await configLoader.findConfigPath(cwd);
    if (configPath) {
      protocolRoot = dirname(dirname(configPath));
    } else if (gitRoot) {
      protocolRoot = gitRoot;
    }
  } catch {
    // Best-effort
  }

  const isScoped = !!gitRoot && !!protocolRoot && protocolRoot !== gitRoot;

  return { protocolRoot, isScoped };
}
