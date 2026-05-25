import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { IConfigLoader } from '../interfaces/config-loader.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { FormattableDoctorResult, DoctorCheck } from '../types/output.js';
import type { IProtocol } from '../interfaces/protocol.js';

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
    getFormatter: () => IOutputFormatter;
    protocol: IProtocol | undefined;
  },
): void {
  program
    .command('doctor')
    .description('Check the health of the decision repository')
    .action(async () => {
      const { atomRepository, configLoader, gitClient, protocol, getFormatter } = deps;
      const checks: DoctorCheck[] = [];

      // 1. Git Repository Check
      checks.push(await checkGitRepo(gitClient));

      // 2. Configuration Check
      checks.push(await checkConfig(configLoader));

      // 3. Atom Discovery & Integrity Check
      if (protocol) {
          checks.push(await checkAtoms(atomRepository));
          checks.push(await checkDuplicateIdentities(atomRepository, protocol));
          checks.push(await checkOrphanedDependencies(atomRepository, protocol));
      }

      const summary = {
        errors: checks.filter((c) => c.status === 'error').length,
        warnings: checks.filter((c) => c.status === 'warning').length,
        info: checks.filter((c) => c.status === 'info').length,
      };

      const doctorResult: FormattableDoctorResult = {
        checks,
        summary,
      };

      const formatter = getFormatter();
      console.log(formatter.formatDoctorResult(doctorResult));
    });
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

async function checkConfig(configLoader: IConfigLoader): Promise<DoctorCheck> {
  const configPath = await configLoader.findConfigPath(process.cwd());
  if (!configPath) {
    return {
      name: 'Configuration',
      status: 'warning',
      message: 'No local config file found. Using default protocol rules.',
      details: [],
    };
  }
  return {
    name: 'Configuration',
    status: 'ok',
    message: `Config file found: ${configPath}`,
    details: [],
  };
}

async function checkAtoms(atomRepository: AtomRepository): Promise<DoctorCheck> {
  const atoms = await atomRepository.findAll({ maxCommits: 100 });
  if (atoms.length === 0) {
    return {
      name: 'Decision Atoms',
      status: 'info',
      message: 'No atoms found in the last 100 commits.',
      details: [],
    };
  }
  return {
    name: 'Decision Atoms',
    status: 'ok',
    message: `Discovered ${atoms.length} atoms in the last 100 commits`,
    details: [],
  };
}

async function checkDuplicateIdentities(
  atomRepository: AtomRepository,
  protocol: IProtocol,
): Promise<DoctorCheck> {
  const atoms = await atomRepository.findAll({ maxCommits: 500 });
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
      name: 'Identity uniqueness',
      status: 'error',
      message: `${duplicates.length} duplicate ${protocol.identityKey}(s) found`,
      details: duplicates,
    };
  }

  return {
    name: 'Identity uniqueness',
    status: 'ok',
    message: `All ${protocol.identityKey}s are unique`,
    details: [],
  };
}

async function checkOrphanedDependencies(
  atomRepository: AtomRepository,
  protocol: IProtocol,
): Promise<DoctorCheck> {
  const atoms = await atomRepository.findAll({ maxCommits: 500 });
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
          orphaned.push(`${atom.commitHash.slice(0, 8)} -> ${id} (${key})`);
        }
      }
    }
  }

  if (orphaned.length > 0) {
    return {
      name: 'Orphaned dependencies',
      status: 'warning',
      message: `${orphaned.length} atom(s) depend on superseded atoms`,
      details: orphaned,
    };
  }

  return {
    name: 'Orphaned dependencies',
    status: 'ok',
    message: 'No orphaned dependencies found',
    details: [],
  };
}
