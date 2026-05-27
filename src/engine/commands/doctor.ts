import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { IConfigLoader } from '../interfaces/config-loader.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { FormattableDoctorResult, DoctorCheck } from '../types/output.js';
import type { IProtocol } from '../interfaces/protocol.js';
import type { ProtocolRegistry } from '../services/protocol-registry.js';
import type { ILogger } from '../interfaces/logger.js';
import { ENGINE_CONFIG_SCHEMA } from '../types/config.js';
import { analyzeConfigGaps } from '../util/config-analyzer.js';
import { parse as parseToml } from 'smol-toml';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';

/**
 * Register the doctor command.
 * Performs automated health checks on the decision repository.
 */
export function registerDoctorCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    configLoader: IConfigLoader;
    gitClient: IGitClient;
    protocolRegistry: ProtocolRegistry;
    getFormatter: () => IOutputFormatter;
    cacheDir: string;
    defaultConfig: any;
    logger: ILogger;
  },
): void {
  program
    .command('doctor')
    .description('Check the health of the decision repository')
    .action(async () => {
      const { atomRepository, configLoader, gitClient, protocolRegistry, getFormatter, cacheDir, defaultConfig, logger } = deps;
      const formatter = getFormatter();
      const checks: DoctorCheck[] = [];

      // 1. Git Repository Check
      checks.push(await checkGitRepo(gitClient));

      // 2. Configuration Check
      checks.push(await checkConfig(configLoader, defaultConfig));

      // 3. Cache Directory Check
      const cacheExists = await fileExists(cacheDir);
      checks.push({
          name: 'Local Cache',
          status: cacheExists ? 'ok' : 'warning',
          message: cacheExists ? 'Cache directory initialized' : 'Cache directory missing',
          details: cacheExists ? [] : ['Using defaults']
      });

      // 4. Multi-Protocol Checks
      const isRepo = await gitClient.isInsideRepo();
      if (isRepo) {
          const atoms = await atomRepository.findAll({ maxCommits: 500 });
          
          // a. General Discovery Check
          checks.push(checkAtoms(atoms));

          for (const protocol of protocolRegistry.getAll()) {
              checks.push(await checkProtocolIntegrity(atomRepository, protocol, atoms));
              checks.push(await checkProtocolReferences(atomRepository, protocol, atoms));
          }
      }

      const summary = {
        total: checks.length,
        errors: checks.filter((c) => c.status === 'error').length,
        warnings: checks.filter((c) => c.status === 'warning').length,
        info: checks.filter((c) => c.status === 'info').length,
      };

      const doctorResult: FormattableDoctorResult = {
        status: summary.errors > 0 ? 'unhealthy' : 'healthy',
        checks,
        summary,
      };

      logger.result(formatter.formatDoctorResult(doctorResult));
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

async function checkGitRepo(gitClient: IGitClient): Promise<DoctorCheck> {
  const isRepo = await gitClient.isInsideRepo();
  if (!isRepo) {
    return {
      name: 'Git Repository',
      status: 'error',
      message: 'Not a git repository. Decisions must be stored in git.',
      details: [],
    };
  }
  return {
    name: 'Git Repository',
    status: 'ok',
    message: 'Valid git repository found',
    details: [],
  };
}

async function checkConfig(configLoader: IConfigLoader, defaultConfig: any): Promise<DoctorCheck> {
  const configPath = await configLoader.findConfigPath(process.cwd());
  if (!configPath) {
    return {
      name: 'Configuration',
      status: 'warning',
      message: 'No local config file found. Using default protocol rules.',
      details: [],
    };
  }

  const details: string[] = [];
  try {
      const content = await readFile(configPath, 'utf-8');
      const parsed = parseToml(content) as any;
      const { missing } = analyzeConfigGaps(parsed, ENGINE_CONFIG_SCHEMA, defaultConfig);
      if (missing.length > 0) {
          details.push('Missing engine options:');
          details.push(...missing.map(m => `  - ${m}`));
      }
  } catch {
      details.push('Failed to parse config for gap analysis');
  }

  return {
    name: 'Configuration',
    status: details.length > 0 ? 'warning' : 'ok',
    message: details.length > 0 ? 'Config file found with gaps' : 'Config file found and verified',
    details,
  };
}

function checkAtoms(atoms: any[]): DoctorCheck {
  if (atoms.length === 0) {
    return {
      name: 'Decision Atoms',
      status: 'info',
      message: 'No atoms found in the last 500 commits.',
      details: [],
    };
  }
  return {
    name: 'Decision Atoms',
    status: 'ok',
    message: `Discovered ${atoms.length} atoms in the last 500 commits`,
    details: [],
  };
}

async function checkProtocolIntegrity(
  atomRepository: AtomRepository,
  protocol: IProtocol,
  atoms: any[]
): Promise<DoctorCheck> {
  const counts = new Map<string, number>();
  const protocolName = protocol.name.toLowerCase();

  for (const atom of atoms) {
    const state = atom.protocols.get(protocolName);
    if (!state) continue;

    const id = protocol.getIdentity(state.trailers);
    if (id) {
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }

  const duplicates: string[] = [];
  for (const [id, count] of counts.entries()) {
    if (count > 1) {
      duplicates.push(`${protocol.identityKey} "${id}" appears ${count} times`);
    }
  }

  if (duplicates.length > 0) {
    return {
      name: `Identity Integrity (${protocol.name})`,
      status: 'error',
      message: `duplicate ${protocol.identityKey}(s) found`,
      details: duplicates,
    };
  }

  return {
    name: `Identity Integrity (${protocol.name})`,
    status: 'ok',
    message: 'ok',
    details: [],
  };
}

async function checkProtocolReferences(
  atomRepository: AtomRepository,
  protocol: IProtocol,
  atoms: any[]
): Promise<DoctorCheck> {
  const orphaned: string[] = [];
  const refKeys = protocol.getReferenceKeys();
  const protocolName = protocol.name.toLowerCase();

  for (const atom of atoms) {
    const state = atom.protocols.get(protocolName);
    if (!state) continue;

    for (const key of refKeys) {
      const ids = state.trailers[key] || [];
      for (const id of ids) {
        const target = await atomRepository.findById(id);
        if (!target) {
          orphaned.push(`${protocol.identityKey} "${id}" referenced by ${atom.commitHash.slice(0, 8)} (${key}) not found`);
        }
      }
    }
  }

  if (orphaned.length > 0) {
    return {
      name: `Reference Integrity (${protocol.name})`,
      status: 'error',
      message: 'broken reference(s) found',
      details: orphaned,
    };
  }

  return {
    name: `Reference Integrity (${protocol.name})`,
    status: 'ok',
    message: 'ok',
    details: [],
  };
}
