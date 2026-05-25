import { dirname } from 'node:path';
import type { IConfigLoader } from '../interfaces/config-loader.js';
import type { IGitClient } from '../interfaces/git-client.js';

export interface ProtocolRoots {
  readonly protocolRoot: string;
  readonly gitRoot: string | null;
}

/**
 * Resolves the root directory for protocol operations.
 * 
 * Logic:
 * 1. Walk up from CWD to find nearest protocol directory (using configLoader's knowledge of dirName).
 * 2. If not found, try to find the git repository root.
 * 3. Fallback to process.cwd().
 */
export async function resolveProtocolRoot(
  cwd: string,
  configLoader: IConfigLoader,
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
      // configPath is typically /path/to/.protocol/config.toml
      // so dirname(configPath) is /path/to/.protocol
      // and dirname(dirname(configPath)) is /path/to
      protocolRoot = dirname(dirname(configPath));
    } else if (gitRoot) {
      protocolRoot = gitRoot;
    }
  } catch {
    // Best-effort
  }

  return { protocolRoot, gitRoot };
}
