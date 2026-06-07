import { Command } from 'commander';

import { 
    makeAtomRepository, 
    makeStubFormatter, 
    makeProtocol, 
    makeProtocolRegistry, 
    TEST_ENGINE_CONFIG 
} from '../../src/engine/testing.js';
import { buildLoreCli as realBuildLoreCli } from '../../src/lore/cli-wrapper.js';
import { LoreProtocolDefinition } from '../../src/lore/protocol-definition.js';

/**
 * =============================================================================
 * LORE TEST INFRASTRUCTURE (VITEST ONLY)
 * =============================================================================
 */

/** Creates a real Lore protocol context using the production definition. */
export function makeLoreProtocol() {
    return makeProtocol(LoreProtocolDefinition);
}

/** Creates a registry with the Lore protocol pre-registered. */
export function makeLoreRegistry() {
    return makeProtocolRegistry([makeLoreProtocol()]);
}

/** Creates a full mock dependency bag for Lore-level command tests. */
export function makeMockLoreContext(overrides: any = {}) {
  return {
    atomRepository: makeAtomRepository(),
    protocolRegistry: makeLoreRegistry(),
    getFormatter: () => makeStubFormatter(),
    config: TEST_ENGINE_CONFIG,
    protocolRoot: process.cwd(),
    cwd: process.cwd(),
    ...overrides
  };
}

/** Helper to create a Commander program for testing a specific command. */
export function createLoreProgram(registerFn: (program: Command, deps: any) => void, deps: any) {
    const program = new Command();
    program.exitOverride();
    registerFn(program, deps);
    return program;
}

/** Wrapper around the real buildLoreCli for E2E-style testing. */
export async function buildLoreCli() {
  return realBuildLoreCli();
}
