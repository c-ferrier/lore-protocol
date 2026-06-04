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

const engineUtilsAbs = path.resolve(process.cwd(), 'tests/engine/engine-test-utils.js');
const loreUtilsAbs = path.resolve(process.cwd(), 'tests/lore/lore-test-utils.js');
const testingGatewayAbs = path.resolve(process.cwd(), 'src/engine/testing.js');

const mapping = {
    // Mocks & Helpers (Utils)
    'makeMockGitClient': 'utils', 'makeMockProtocol': 'utils', 'makeMockPrompt': 'utils', 
    'makeMockFormatter': 'utils', 'makeMockAtomRepository': 'utils', 'makeMockConfigLoader': 'utils', 
    'makeMockInputResolver': 'utils', 'makeMockHeadIdReader': 'utils', 'makeMockStalenessDetector': 'utils', 
    'makeMockValidator': 'utils', 'makeMockProtocolRegistry': 'utils', 'makeMockLoreContext': 'utils', 
    'createLoreProgram': 'utils', 'TestLogger': 'utils',
    'makeProtocol': 'utils', 'makeProtocolRegistry': 'utils', 'makeAtom': 'utils', 
    'makeTrailers': 'utils', 'makeRawCommit': 'utils', 'TEST_PROTOCOL_DEFINITION': 'utils', 
    'TEST_ENGINE_CONFIG': 'utils', 'TEST_PROTOCOL_CONFIG': 'utils', 'TEST_ID_KEY': 'utils', 
    'TEST_YAP_DEFINITION': 'utils', 'makeCommitInput': 'utils', 'makeStubProtocol': 'utils', 
    'makeStubGitClient': 'utils', 'makeStubPrompt': 'utils', 'makeStubFormatter': 'utils', 
    'makeStubConfigLoader': 'utils', 'makeStubInputResolver': 'utils', 'makeStubHeadIdReader': 'utils', 
    'makeStubAtomRepository': 'utils', 'makeStubValidator': 'utils', 'makeStubStalenessDetector': 'utils', 
    'makeStubProtocolRegistry': 'utils', 'makeProtocolConfig': 'utils', 'makeQueryTarget': 'utils', 
    'assertIsolatedEngine': 'utils', 'TEST_ENGINE_DIR': 'utils', 'makeQueryOptions': 'utils',

    // Core Classes & Logic (Testing Gateway)
    'ActiveProtocol': 'gateway', 'ProtocolRegistry': 'gateway', 'ProtocolLoader': 'gateway', 
    'AtomRepository': 'gateway', 'Validator': 'gateway', 'StalenessDetector': 'gateway', 
    'NullQueryCache': 'gateway', 'InMemoryLogger': 'gateway', 'ProtocolMap': 'gateway',
    'hydrateAtoms': 'gateway', 'extractReferenceIds': 'gateway', 'resolveSupersession': 'gateway', 
    'generateId': 'gateway', 'parseTrailers': 'gateway', 'serializeTrailers': 'gateway', 
    'filterAtoms': 'gateway', 'resolveFilters': 'gateway', 'createQueryTarget': 'gateway', 
    'createTargetFromIdentities': 'gateway', 'getCacheFingerprint': 'gateway', 'isBlameTarget': 'gateway', 
    'getGitLogArgs': 'gateway', 'getGitBlameArgs': 'gateway', 'evaluateStaleness': 'gateway', 'getDrift': 'gateway',
    'resolvePath': 'gateway', 'resolveGitRoot': 'gateway', 'getActiveRoot': 'gateway',

    // Shell/CLI Classes (Direct)
    'GitClient': 'src/engine/shell/git/git-client.js',
    'QueryCache': 'src/engine/shell/fs/query-cache.js',
    'ConfigLoader': 'src/engine/shell/fs/config-loader.js',
    'RootResolver': 'src/engine/shell/fs/root-resolver.js',
    'DynamicProtocolLoader': 'src/engine/shell/fs/protocol-loader.js',
    'ProtocolHydrator': 'src/engine/shell/fs/protocol-hydrator.js',
    'TerminalLogger': 'src/engine/cli/io/terminal-logger.js',
    'TerminalPrompt': 'src/engine/cli/io/terminal-prompt.js',
    'JsonInputReader': 'src/engine/cli/readers/json-input-reader.js',
    'InteractiveInputReader': 'src/engine/cli/readers/interactive-input-reader.js',
    'CommitInputResolver': 'src/engine/cli/readers/commit-input-resolver.js',
    'MultiValueTrailerCollector': 'src/engine/cli/readers/collectors/multi-value-trailer-collector.js',
    'EnumChoiceTrailerCollector': 'src/engine/cli/readers/collectors/enum-choice-trailer-collector.js',
    'createTrailerCollectors': 'src/engine/cli/readers/collectors/trailer-collector-registry.js',
    'LoreConfigLoader': 'src/engine/lore/services/lore-config-loader.js',
    'LoreTextFormatter': 'src/lore/formatters/lore-text-formatter.js',
    'LoreJsonFormatter': 'src/lore/formatters/lore-json-formatter.js',
    'registerCommitCommand': 'src/engine/cli/commands/commit.js',
    'registerLogCommand': 'src/engine/cli/commands/log.js',
    'registerSearchCommand': 'src/engine/cli/commands/search.js',
    'registerContextCommand': 'src/engine/cli/commands/context.js',
    'registerConstraintsCommand': 'src/engine/cli/commands/constraints.js',
    'executePathQuery': 'src/engine/cli/commands/helpers/path-query.js',
    'addPathQueryOptions': 'src/engine/cli/commands/helpers/path-query.js',
    'mergeOptions': 'src/engine/cli/commands/helpers/merge-options.js',
    'ProtocolError': 'src/engine/util/errors.js',
    'ConfigurationError': 'src/engine/util/errors.js',
    'getEngineVersion': 'src/engine/util/version.js',
    'getEnginePackageName': 'src/engine/util/version.js',
    'getLoreVersion': 'src/lore/util/version.js',

    // Types (Testing Gateway)
    'ProtocolName': 'gateway', 'Atom': 'gateway', 'Trailers': 'gateway', 'HierarchicalTrailers': 'gateway', 
    'ProtocolState': 'gateway', 'SupersessionStatus': 'gateway', 'StaleReason': 'gateway', 'StaleSignal': 'gateway', 
    'IGitClient': 'gateway', 'RawCommit': 'gateway', 'CommitResult': 'gateway', 'BlameLine': 'gateway', 
    'IQueryCache': 'gateway', 'IOutputFormatter': 'gateway', 'ErrorMessage': 'gateway', 
    'ProtocolDefinition': 'gateway', 'EngineConfig': 'gateway', 'ProtocolConfig': 'gateway', 
    'TrailerUiKind': 'gateway', 'TrailerUiColor': 'gateway', 'TrailerDefinition': 'gateway', 
    'CommitInput': 'gateway', 'ValidationIssue': 'gateway', 'FormattableTrailerDefinition': 'gateway', 
    'QualifiedFilter': 'gateway', 'SearchOptions': 'gateway', 'QueryTargetAST': 'gateway', 
    'QueryIdentity': 'gateway', 'IConfigLoader': 'gateway', 'IPrompt': 'gateway', 
    'ICommitInputReader': 'gateway', 'PathQueryOptions': 'gateway', 'StaleIfCondition': 'gateway',
    'FormattableQueryResult': 'gateway', 'FormattableValidationResult': 'gateway', 
    'FormattableStalenessResult': 'gateway', 'FormattableTraceResult': 'gateway', 
    'FormattableConfigResult': 'gateway'
};

for (const file of allFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    const fileDir = path.dirname(file);

    // 1. Identify all symbols used in the file
    const symbolsUsed = new Set();
    for (const sym in mapping) {
        // Simple regex to find the symbol usage, but NOT in a comment or string
        // This is a heuristic but works well for TS files.
        const usageRegex = new RegExp(`\\b${sym}\\b`, 'g');
        if (usageRegex.test(content)) {
            // Check if it's actually imported or just mentioned in comments
            // (Testing for import lines is easier)
            symbolsUsed.add(sym);
        }
    }

    if (symbolsUsed.size === 0) continue;

    // 2. Wipe ALL old engine/lore imports
    const oldImportRegex = /import\s+\{([^}]*)\}\s+from\s+['"]([^'"]*?(engine|lore|src\/engine|test-utils)[^'"]*)['"];?/g;
    content = content.replace(oldImportRegex, '');
    content = content.trim();

    // 3. Re-group symbols by their destination
    const groups = {};

    for (const sym of symbolsUsed) {
        let dest = mapping[sym];
        if (dest === 'utils') {
            dest = file.includes('tests/lore/') ? loreUtilsAbs : engineUtilsAbs;
        } else if (dest === 'gateway') {
            dest = testingGatewayAbs;
        } else {
            dest = path.resolve(process.cwd(), dest);
        }

        if (!groups[dest]) groups[dest] = new Set();
        groups[dest].add(sym);
    }

    const newImports = [];
    for (const dest in groups) {
        let rel = path.relative(fileDir, dest).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = './' + rel;
        
        const syms = Array.from(groups[dest]).sort();
        newImports.push(`import { ${syms.join(', ')} } from '${rel}';`);
    }

    if (newImports.length > 0) {
        content = newImports.join('\n') + '\n\n' + content;
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Reset and Aligned ${file}`);
    }
}
