import { type Mocked } from 'vitest';

import type { ICommitInputReader } from '../src/engine/interfaces/commit-input-reader.js';
import type { IConfigLoader } from '../src/engine/interfaces/config-loader.js';
import type { IGitClient } from '../src/engine/interfaces/git-client.js';
import type { IIdentityIndex } from '../src/engine/interfaces/identity-index.js';
import type { IOutputFormatter } from '../src/engine/interfaces/output-formatter.js';
import type { IPrompt } from '../src/engine/interfaces/prompt.js';
import type { IQueryCache } from '../src/engine/interfaces/query-cache.js';
import type { EngineInfra } from '../src/engine/services/engine-bootstrapper.js';

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
export type MockedEngineInfra = Mocked<EngineInfra>;
