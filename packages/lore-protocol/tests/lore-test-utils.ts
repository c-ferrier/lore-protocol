import type { EngineInfra, EngineOptions } from '@c-ferrier/atom-engine';
import { ProtocolMap } from '@c-ferrier/atom-engine/testing';
import { 
    makeStubFormatter, 
    makeStubIdentityIndex,
    makeStubProtocolContext, 
    type ProtocolContext, 
    TEST_ENGINE_CONFIG} from '@c-ferrier/atom-engine/testing';
import { Command } from 'commander';

import { makeMockGitClient, makeMockPrompt, makeMockQueryCache, TestLogger } from '../../atom-engine/tests/engine-test-utils.js';
import { buildLoreCli as realBuildLoreCli } from '../src/cli-wrapper.js';
import { LoreProtocolDefinition } from '../src/protocol-definition.js';

/**
 * =============================================================================
 * LORE TEST INFRASTRUCTURE (VITEST ONLY)
 * =============================================================================
 */

/** Creates a real Lore protocol context using the production definition. */
export function makeLoreProtocol() {
    return makeStubProtocolContext(LoreProtocolDefinition);
}

/** Creates a ProtocolMap with the Lore protocol pre-registered. */
export function makeLoreProtocolMap() {
    const map = new ProtocolMap<ProtocolContext>();
    const lore = makeLoreProtocol();
    map.set(lore.name, lore);
    return map;
}

/** Creates a full mock dependency bag for Lore-level command tests. */
export function makeMockLoreInfra(overrides: Partial<EngineInfra> = {}): EngineInfra {
  return {
    git: makeMockGitClient(),
    cache: makeMockQueryCache(),
    identityIndex: makeStubIdentityIndex(),
    protocols: makeLoreProtocolMap(),
    getFormatter: () => makeStubFormatter(),
    logger: new TestLogger(),
    config: TEST_ENGINE_CONFIG,
    protocolRoot: process.cwd(),
    cwd: process.cwd(),
    prompt: makeMockPrompt(),
    baseTarget: { type: 'global', raw: 'all', resolvedPaths: [] },
    ...overrides
  };
}

/** Helper to create a Commander program for testing a specific command. */
export function createLoreProgram(registerFn: (program: Command, infra: EngineInfra) => void, infra: EngineInfra) {
    const program = new Command();
    program.exitOverride();
    registerFn(program, infra);
    return program;
}

/** Wrapper around the real buildLoreCli for E2E-style testing. */
export async function buildLoreCli(overrides: Partial<EngineOptions> = {}) {
  return realBuildLoreCli(overrides);
}
