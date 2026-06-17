import { type Mocked, type MockedFunction } from 'vitest';

import { type ICommitInputReader } from '../src/interfaces/commit-input-reader.js';
import { type IConfigLoader } from '../src/interfaces/config-loader.js';
import { type IGitClient } from '../src/interfaces/git-client.js';
import { type IIdentityIndex } from '../src/interfaces/identity-index.js';
import { type ILogger } from '../src/interfaces/logger.js';
import { type IOutputFormatter } from '../src/interfaces/output-formatter.js';
import { type IPrompt } from '../src/interfaces/prompt.js';
import { type IQueryCache } from '../src/interfaces/query-cache.js';
import { type EngineInfra } from '../src/services/engine-bootstrapper.js';

/**
 * =============================================================================
 * EXPLICIT MOCKED TYPES
 * =============================================================================
 * These types provide a first-class contract for mocked services.
 * Tests should use these instead of deriving types from factory functions.
 */

export type MockedGitClient = Mocked<IGitClient>;
export type MockedQueryCache = Mocked<IQueryCache>;
export type MockedIdentityIndex = Mocked<IIdentityIndex>;
export type MockedConfigLoader = Mocked<IConfigLoader<unknown>>;
export type MockedOutputFormatter = Mocked<IOutputFormatter>;
export type MockedPrompt = Mocked<IPrompt>;
export type MockedInputResolver = Mocked<ICommitInputReader>;
export type MockedLogger = Mocked<ILogger>;

/**
 * High-fidelity mocked infrastructure bag.
 * Explicitly overrides service members to provide Vitest mock capabilities
 * while preserving static data properties.
 */
export interface MockedEngineInfra extends EngineInfra {
  readonly git: MockedGitClient;
  readonly cache: MockedQueryCache;
  readonly identityIndex: MockedIdentityIndex;
  readonly prompt: MockedPrompt;
  readonly getFormatter: MockedFunction<EngineInfra['getFormatter']>;
}
