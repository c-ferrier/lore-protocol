import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EngineBootstrapper } from '../../src/engine/services/engine-bootstrapper.js';
import { TEST_ENGINE_CONFIG, createLoreProgram, makeLoreProtocol, makeLoreRegistry, makeMockAtomRepository, makeMockFormatter, makeMockLoreContext, makeProtocol, makeProtocolRegistry } from '../../src/engine/testing.js';
import { LoreProtocolDefinition } from '../../src/lore/protocol-definition.js';
import { LoreConfigLoader } from '../../src/lore/services/lore-config-loader.js';

import { Command } from 'commander';

import { buildLoreCli as realBuildLoreCli } from '../../src/lore/cli-wrapper.js';

/**
 * =============================================================================
 * LORE TEST INFRASTRUCTURE (VITEST ONLY)
 * =============================================================================
 */

export function makeLoreProtocol() {
    return makeProtocol(LoreProtocolDefinition);
}

export function makeLoreRegistry() {
    return makeProtocolRegistry([makeLoreProtocol()]);
}

export function makeMockLoreContext(overrides: any = {}) {
  return {
    atomRepository: makeMockAtomRepository(),
    protocolRegistry: makeLoreRegistry(),
    getFormatter: () => makeMockFormatter(),
    config: TEST_ENGINE_CONFIG,
    ...overrides
  };
}

export function createLoreProgram(registerFn: (program: Command, deps: any) => void, deps: any) {
    const program = new Command();
    program.exitOverride();
    registerFn(program, deps);
    return program;
}

export async function buildLoreCli(_options: { basePath: string, engineDirName: string, configFileName: string }) {
  // Use the real production buildLoreCli to ensure we test the actual 
  // orchestration logic, hooks, and rebranding shims.
  // Note: We ignore the options because the production wrapper 
  // uses process.cwd() and constants, and the tests already stub process.cwd().
  return realBuildLoreCli();
}