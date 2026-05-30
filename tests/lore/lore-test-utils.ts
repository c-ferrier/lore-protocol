import { vi } from 'vitest';
import { 
    makeProtocol, 
    makeProtocolRegistry, 
    makeMockAtomRepository, 
    makeMockSupersessionResolver,
    makeMockFormatter,
    TEST_ENGINE_CONFIG
} from '../engine/engine-test-utils.js';
import { LoreProtocolDefinition } from '../../src/lore/protocol-definition.js';
import { ProtocolRegistry } from '../../src/engine/services/protocol-registry.js';
import { Command } from 'commander';

/**
 * =============================================================================
 * LORE TEST INFRASTRUCTURE
 * =============================================================================
 * Lore-specific factories and constants. These build upon the core Atom Engine
 * testing infrastructure.
 * =============================================================================
 */

/**
 * TEST: The standard Lore Protocol instance.
 */
export function makeLoreProtocol() {
    return makeProtocol(LoreProtocolDefinition);
}

/**
 * TEST: A registry pre-populated with the Lore protocol.
 */
export function makeLoreRegistry() {
    return makeProtocolRegistry([makeLoreProtocol()]);
}

/**
 * Factory: Create high-fidelity mocks for Lore-dependent engine services.
 */
export function makeMockLoreContext(overrides: any = {}) {
  return {
    atomRepository: makeMockAtomRepository(),
    supersessionResolver: makeMockSupersessionResolver(),
    protocolRegistry: makeLoreRegistry(),
    getFormatter: () => makeMockFormatter(),
    config: TEST_ENGINE_CONFIG,
    ...overrides
  };
}

/**
 * Helper: Create a fresh Commander program with Lore commands registered.
 */
export function createLoreProgram(registerFn: (program: Command, deps: any) => void, deps: any) {
    const program = new Command();
    program.exitOverride();
    registerFn(program, deps);
    return program;
}
