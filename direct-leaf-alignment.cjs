const fs = require('fs');
const path = require('path');

function getFiles(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getFiles(filePath));
        } else if (filePath.endsWith('.ts')) {
            results.push(filePath);
        }
    });
    return results;
}

const allFiles = getFiles('tests');

const testingGatewayAbs = path.resolve(process.cwd(), 'src/engine/testing.ts');

const typeSymbols = new Set([
    'ProtocolName', 'Atom', 'Trailers', 'HierarchicalTrailers', 'ProtocolState',
    'SupersessionStatus', 'StaleReason', 'StaleSignal', 'IGitClient', 'RawCommit',
    'CommitResult', 'BlameLine', 'IQueryCache', 'IOutputFormatter', 'ErrorMessage',
    'ProtocolDefinition', 'EngineConfig', 'ProtocolConfig', 'TrailerUiKind',
    'TrailerUiColor', 'TrailerDefinition', 'StaleIfCondition', 'CommitInput',
    'ValidationIssue', 'FormattableTrailerDefinition', 'QualifiedFilter',
    'SearchOptions', 'QueryTargetAST', 'QueryIdentity', 'FilterOperator',
    'IConfigLoader', 'IPrompt', 'ICommitInputReader', 'FormattableQueryResult',
    'FormattableValidationResult', 'FormattableStalenessResult', 'FormattableTraceResult',
    'FormattableConfigResult', 'FormattableDoctorResult', 'DoctorCheck',
    'PathQueryDeps', 'PathQueryCommandOptions', 'PathQueryOptions', 'ActiveTrailer'
]);

const mapping = {
    // --- PRODUCTION LEAF FILES ---
    'ActiveProtocol': 'src/engine/core/models/active-protocol.ts',
    'ActiveTrailer': 'src/engine/core/models/active-protocol.ts',
    'ProtocolMap': 'src/engine/core/models/protocol-map.ts',
    'ProtocolRegistry': 'src/engine/services/protocol-registry.ts',
    'AtomRepository': 'src/engine/services/atom-repository.ts',
    'Validator': 'src/engine/services/validator.ts',
    'StalenessDetector': 'src/engine/services/staleness-detector.ts',
    'InMemoryLogger': 'src/engine/services/in-memory-logger.ts',
    'EngineBootstrapper': 'src/engine/services/engine-bootstrapper.ts',
    'ProtocolQueryAdapter': 'src/engine/shell/git/protocol-query-adapter.ts',
    'GitClient': 'src/engine/shell/git/git-client.ts',
    'HeadIdReader': 'src/engine/shell/git/head-id-reader.ts',
    'ProtocolLoader': 'src/engine/shell/fs/protocol-loader.ts',
    'DynamicProtocolLoader': 'src/engine/shell/fs/protocol-loader.ts',
    'ProtocolHydrator': 'src/engine/shell/fs/protocol-hydrator.ts',
    'NullQueryCache': 'src/engine/shell/fs/query-cache.ts',
    'QueryCache': 'src/engine/shell/fs/query-cache.ts',
    'ConfigLoader': 'src/engine/shell/fs/config-loader.ts',
    'EngineConfigLoader': 'src/engine/shell/fs/config-loader.ts',
    'RootResolver': 'src/engine/shell/fs/root-resolver.ts',
    'resolveProtocolRoot': 'src/engine/shell/fs/root-resolver.ts',
    'TerminalLogger': 'src/engine/cli/io/terminal-logger.ts',
    'TerminalPrompt': 'src/engine/cli/io/terminal-prompt.ts',
    'JsonInputReader': 'src/engine/cli/readers/json-input-reader.ts',
    'InteractiveInputReader': 'src/engine/cli/readers/interactive-input-reader.ts',
    'CommitInputResolver': 'src/engine/cli/readers/commit-input-resolver.ts',
    'MultiValueTrailerCollector': 'src/engine/cli/readers/collectors/multi-value-trailer-collector.ts',
    'EnumChoiceTrailerCollector': 'src/engine/cli/readers/collectors/enum-choice-trailer-collector.ts',
    'TrailerCollectorRegistry': 'src/engine/cli/readers/collectors/trailer-collector-registry.ts',
    'createTrailerCollectors': 'src/engine/cli/readers/collectors/trailer-collector-registry.ts',
    'JsonFormatter': 'src/engine/formatters/json-formatter.ts',
    'TextFormatter': 'src/engine/formatters/text-formatter.ts',
    'LoreTextFormatter': 'src/lore/formatters/lore-text-formatter.ts',
    'LoreJsonFormatter': 'src/lore/formatters/lore-json-formatter.ts',
    'LoreConfigLoader': 'src/lore/services/lore-config-loader.ts',
    'LoreProtocolDefinition': 'src/lore/protocol-definition.ts',
    'LORE_STALE_SIGNAL': 'src/lore/constants.ts',

    // --- LOGIC NODES ---
    'hydrateAtoms': 'src/engine/core/logic/hydration.ts',
    'extractReferenceIds': 'src/engine/core/logic/hydration.ts',
    'resolveSupersession': 'src/engine/core/logic/supersession.ts',
    'filterActiveAtoms': 'src/engine/core/logic/supersession.ts',
    'generateId': 'src/engine/core/logic/identity.ts',
    'parseTrailers': 'src/engine/core/logic/trailers.ts',
    'serializeTrailers': 'src/engine/core/logic/trailers.ts',
    'filterAtoms': 'src/engine/core/logic/filtering.ts',
    'resolveFilters': 'src/engine/core/logic/filtering.ts',
    'resolveFilterStrings': 'src/engine/core/logic/filtering.ts',
    'squashAtoms': 'src/engine/core/logic/squashing.ts',
    'formatCommit': 'src/engine/core/logic/commit-formatting.ts',
    'validateFormatting': 'src/engine/core/logic/commit-formatting.ts',
    'normalizePathToRoot': 'src/engine/core/logic/path-resolution.ts',
    'resolvePath': 'src/engine/core/logic/path-resolution.ts',
    'createQueryTarget': 'src/engine/core/logic/query-targets.ts',
    'createTargetFromIdentities': 'src/engine/core/logic/query-targets.ts',
    'getCacheFingerprint': 'src/engine/core/logic/query-targets.ts',
    'isBlameTarget': 'src/engine/core/logic/query-targets.ts',
    'getGitLogArgs': 'src/engine/core/logic/query-targets.ts',
    'getGitBlameArgs': 'src/engine/core/logic/query-targets.ts',
    'evaluateHygiene': 'src/engine/core/logic/validation.ts',
    'evaluateProtocolSchema': 'src/engine/core/logic/validation.ts',
    'evaluateTrailerHygiene': 'src/engine/core/logic/validation.ts',
    'parseFlagsToInput': 'src/engine/core/logic/input-interpretation.ts',
    'selectInputMode': 'src/engine/core/logic/input-interpretation.ts',
    'finalizeCommitInput': 'src/engine/core/logic/input-interpretation.ts',
    'InputMode': 'src/engine/core/logic/input-interpretation.ts',

    // --- UTILS ---
    'slugify': 'src/engine/util/string.ts',
    'camelCase': 'src/engine/util/string.ts',
    'snakeCase': 'src/engine/util/string.ts',
    'formatAge': 'src/engine/core/logic/staleness.ts',
    'evaluateAgeSignal': 'src/engine/core/logic/staleness.ts',
    'evaluateDriftSignal': 'src/engine/core/logic/staleness.ts',
    'parseDuration': 'src/engine/core/logic/staleness.ts',
    'getEngineVersion': 'src/engine/util/version.ts',
    'getEnginePackageName': 'src/engine/util/version.ts',
    'checkForUpdates': 'src/engine/util/update-check.ts',
    'ProtocolError': 'src/engine/util/errors.ts',
    'ConfigurationError': 'src/engine/util/errors.ts',
    'ENGINE_CONFIG_FILENAME': 'src/engine/util/constants.ts',
    'ENGINE_DIR_NAME': 'src/engine/util/constants.ts',
    'STALE_SIGNAL': 'src/engine/util/constants.ts',
    'GLOBAL_CACHE_KEY': 'src/engine/util/constants.ts',
    'LogLevel': 'src/engine/interfaces/logger.ts',

    // --- COMMANDS ---
    'registerLogCommand': 'src/engine/cli/commands/log.ts',
    'registerCommitCommand': 'src/engine/cli/commands/commit.ts',
    'registerSearchCommand': 'src/engine/cli/commands/search.ts',
    'registerTraceCommand': 'src/engine/cli/commands/trace.ts',
    'registerDoctorCommand': 'src/engine/cli/commands/doctor.ts',
    'registerCacheCommand': 'src/engine/cli/commands/cache.ts',
    'registerInitCommand': 'src/engine/cli/commands/init.ts',
    'executeEngineInit': 'src/engine/cli/commands/init.ts',
    'executePathQuery': 'src/engine/cli/commands/helpers/path-query.ts',
    'addPathQueryOptions': 'src/engine/cli/commands/helpers/path-query.ts',
    'analyzeConfigGaps': 'src/engine/util/config-analyzer.ts',
    'runCli': 'src/engine/index-impl.ts',
    'execute': 'src/engine/index-impl.ts',

    // --- TESTING GATEWAY (Passive Stubs, Data & Shims ONLY) ---
    'makeProtocol': 'src/engine/testing.ts', 
    'makeProtocolRegistry': 'src/engine/testing.ts', 
    'makeAtom': 'src/engine/testing.ts', 
    'makeTrailers': 'src/engine/testing.ts', 
    'makeRawCommit': 'src/engine/testing.ts', 
    'TEST_PROTOCOL_DEFINITION': 'src/engine/testing.ts', 
    'TEST_ENGINE_CONFIG': 'src/engine/testing.ts', 
    'TEST_PROTOCOL_CONFIG': 'src/engine/testing.ts', 
    'TEST_ID_KEY': 'src/engine/testing.ts', 
    'TEST_YAP_DEFINITION': 'src/engine/testing.ts', 
    'makeCommitInput': 'src/engine/testing.ts', 
    'makeStubProtocol': 'src/engine/testing.ts', 
    'makeStubGitClient': 'src/engine/testing.ts', 
    'makeStubPrompt': 'src/engine/testing.ts', 
    'makeStubFormatter': 'src/engine/testing.ts', 
    'makeStubConfigLoader': 'src/engine/testing.ts', 
    'makeStubInputResolver': 'src/engine/testing.ts', 
    'makeStubHeadIdReader': 'src/engine/testing.ts', 
    'makeStubAtomRepository': 'src/engine/testing.ts', 
    'makeStubValidator': 'src/engine/testing.ts', 
    'makeStubStalenessDetector': 'src/engine/testing.ts', 
    'makeStubProtocolRegistry': 'src/engine/testing.ts', 
    'makeProtocolConfig': 'src/engine/testing.ts', 
    'makeQueryTarget': 'src/engine/testing.ts', 
    'assertIsolatedEngine': 'src/engine/testing.ts', 
    'TEST_ENGINE_DIR': 'src/engine/testing.ts',
    'ProtocolInterpreter': 'src/engine/testing.ts', 
    'ProtocolValidator': 'src/engine/testing.ts', 
    'ProtocolSchema': 'src/engine/testing.ts',

    // --- VITEST SPIES (Test Utils Middlemen) ---
    'makeMockGitClient': 'tests/engine/engine-test-utils.ts', 
    'makeMockProtocolRegistry': 'tests/engine/engine-test-utils.ts', 
    'makeMockQueryCache': 'tests/engine/engine-test-utils.ts', 
    'makeMockConfigLoader': 'tests/engine/engine-test-utils.ts', 
    'makeMockFormatter': 'tests/engine/engine-test-utils.ts', 
    'makeMockAtomRepository': 'tests/engine/engine-test-utils.ts', 
    'makeMockPrompt': 'tests/engine/engine-test-utils.ts', 
    'makeMockHeadIdReader': 'tests/engine/engine-test-utils.ts', 
    'makeMockInputResolver': 'tests/engine/engine-test-utils.ts', 
    'makeMockStalenessDetector': 'tests/engine/engine-test-utils.ts', 
    'makeMockValidator': 'tests/engine/engine-test-utils.ts', 
    'makeMockProtocol': 'tests/engine/engine-test-utils.ts', 
    'createMockProtocol': 'tests/engine/engine-test-utils.ts', 
    'TestLogger': 'tests/engine/engine-test-utils.ts', 
    'makeQueryOptions': 'tests/engine/engine-test-utils.ts',
    'makeAtomRepository': 'tests/engine/engine-test-utils.ts', 
    'buildLoreCli': 'tests/engine/engine-test-utils.ts', 
    'makeMockLoreContext': 'tests/lore/lore-test-utils.ts',
    'createLoreProgram': 'tests/lore/lore-test-utils.ts', 
    'makeLoreProtocol': 'tests/lore/lore-test-utils.ts', 
    'makeLoreRegistry': 'tests/lore/lore-test-utils.ts',

    // --- TYPES (Leaf Locations) ---
    'ProtocolName': 'src/engine/core/models/protocol-map.ts',
    'Atom': 'src/engine/core/types/domain.ts',
    'Trailers': 'src/engine/core/types/domain.ts',
    'HierarchicalTrailers': 'src/engine/core/types/domain.ts',
    'ProtocolState': 'src/engine/core/types/domain.ts',
    'SupersessionStatus': 'src/engine/core/types/domain.ts',
    'StaleReason': 'src/engine/core/types/domain.ts',
    'StaleSignal': 'src/engine/core/types/domain.ts',
    'IGitClient': 'src/engine/interfaces/git-client.ts',
    'RawCommit': 'src/engine/interfaces/git-client.ts',
    'CommitResult': 'src/engine/interfaces/git-client.ts',
    'BlameLine': 'src/engine/interfaces/git-client.ts',
    'IQueryCache': 'src/engine/interfaces/query-cache.ts',
    'IOutputFormatter': 'src/engine/interfaces/output-formatter.ts',
    'ErrorMessage': 'src/engine/interfaces/output-formatter.ts',
    'ProtocolDefinition': 'src/engine/core/types/protocol-definition.ts',
    'EngineConfig': 'src/engine/core/types/config.ts',
    'ProtocolConfig': 'src/engine/core/types/config.ts',
    'TrailerUiKind': 'src/engine/core/types/config.ts',
    'TrailerUiColor': 'src/engine/core/types/config.ts',
    'TrailerDefinition': 'src/engine/core/types/config.ts',
    'StaleIfCondition': 'src/engine/core/types/config.ts',
    'CommitInput': 'src/engine/core/types/commit.ts',
    'ValidationIssue': 'src/engine/core/types/output.ts',
    'FormattableTrailerDefinition': 'src/engine/core/types/output.ts',
    'QualifiedFilter': 'src/engine/core/types/query.ts',
    'SearchOptions': 'src/engine/core/types/query.ts',
    'QueryTargetAST': 'src/engine/core/types/query.ts',
    'QueryIdentity': 'src/engine/core/types/query.ts',
    'FilterOperator': 'src/engine/core/types/query.ts',
    'IConfigLoader': 'src/engine/interfaces/config-loader.ts',
    'IPrompt': 'src/engine/interfaces/prompt.ts',
    'ICommitInputReader': 'src/engine/interfaces/commit-input-reader.ts',
    'FormattableQueryResult': 'src/engine/core/types/output.ts',
    'FormattableValidationResult': 'src/engine/core/types/output.ts',
    'FormattableStalenessResult': 'src/engine/core/types/output.ts',
    'FormattableTraceResult': 'src/engine/core/types/output.ts',
    'FormattableConfigResult': 'src/engine/core/types/output.ts',
    'FormattableDoctorResult': 'src/engine/core/types/output.ts',
    'DoctorCheck': 'src/engine/core/types/output.ts'
};

for (const file of allFiles) {
    if (file.endsWith('engine-test-utils.ts') || file.endsWith('lore-test-utils.ts')) {
        continue;
    }

    let rawContent = fs.readFileSync(file, 'utf8');
    const fileDir = path.dirname(file);

    // 1. Identify all symbols used anywhere in the file
    const allSymbolsUsed = new Set();
    for (const sym in mapping) {
        const usageRegex = new RegExp(`\\b${sym}\\b`);
        if (usageRegex.test(rawContent)) {
            allSymbolsUsed.add(sym);
        }
    }

    if (allSymbolsUsed.size === 0) continue;

    // 2. Identify symbols defined locally (EXCLUDING IMPORTS)
    // Strip imports first to find actual local definitions
    const contentNoImports = rawContent.replace(/import\s+.*?\s+from\s+['"].*?['"];?/gs, '').trim();
    const locallyDefined = new Set();
    
    const lines = contentNoImports.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
        
        const funcMatch = trimmed.match(/function\s+([A-Za-z0-9_]+)/);
        if (funcMatch) locallyDefined.add(funcMatch[1]);
        
        const constMatch = trimmed.match(/(const|let|var)\s+([A-Za-z0-9_]+)\b/);
        if (constMatch) {
            // Only add if it looks like a real definition (followed by = or : or whitespace)
            const nextPart = trimmed.substring(constMatch[0].length).trim();
            if (nextPart.startsWith('=') || nextPart.startsWith(':') || nextPart === '') {
                locallyDefined.add(constMatch[2]);
            }
        }
        
        const classMatch = trimmed.match(/class\s+([A-Za-z0-9_]+)/);
        if (classMatch) locallyDefined.add(classMatch[1]);

        const typeMatch = trimmed.match(/type\s+([A-Za-z0-9_]+)\b/);
        if (typeMatch) {
            const nextPart = trimmed.substring(typeMatch[0].length).trim();
            if (nextPart.startsWith('=')) {
                locallyDefined.add(typeMatch[1]);
            }
        }

        const interfaceMatch = trimmed.match(/interface\s+([A-Za-z0-9_]+)\b/);
        if (interfaceMatch) locallyDefined.add(interfaceMatch[1]);
    }

    // 3. Final symbols used (those that need importing)
    const symbolsToImport = new Set();
    for (const sym of allSymbolsUsed) {
        if (!locallyDefined.has(sym)) {
            symbolsToImport.add(sym);
        }
    }

    if (symbolsToImport.size === 0) continue;

    // 4. Wipe ALL old engine/src/test imports - AGGRESSIVE MULTI-LINE
    const oldImportRegex = /import\s+(type\s+)?\{[^}]*\}\s+from\s+['"]([^'"]*?(engine|lore|src\/engine|test-utils|testing\.js|index\.js|testing\.ts|index\.ts)[^'"]*)['"];?/gs;
    let strippedContent = rawContent.replace(oldImportRegex, '').trim();

    // 5. Re-group symbols by their destination
    const groups = {};

    for (const sym of symbolsToImport) {
        const dest = path.resolve(process.cwd(), mapping[sym]);
        if (!groups[dest]) groups[dest] = new Set();
        groups[dest].add(sym);
    }

    const newImports = [];
    const sortedDests = Object.keys(groups).sort();
    for (const dest of sortedDests) {
        let rel = path.relative(fileDir, dest).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = './' + rel;
        
        // Fix ESM .js extension for production files
        if (rel.endsWith('.ts')) rel = rel.replace(/\.ts$/, '.js');
        
        const syms = Array.from(groups[dest]).sort();
        // Standardize: use internal type keyword for types
        const formattedSyms = syms.map(s => typeSymbols.has(s) ? `type ${s}` : s);
        
        newImports.push(`import { ${formattedSyms.join(', ')} } from '${rel}';`);
    }

    if (newImports.length > 0) {
        const finalContent = newImports.join('\n') + '\n\n' + strippedContent;
        fs.writeFileSync(file, finalContent, 'utf8');
        console.log(`Leaf-Aligned ${file} with ${symbolsToImport.size} symbols`);
    }
}
