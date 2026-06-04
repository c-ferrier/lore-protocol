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
    // Vitest Utilities (Utils Middlemen) - THESE SHOULD BE EXCLUDED FROM THE LOOP BELOW
    'makeMockGitClient': 'utils', 'makeMockProtocol': 'utils', 'makeMockQueryCache': 'utils', 
    'makeMockConfigLoader': 'utils', 'makeMockFormatter': 'utils', 'makeMockAtomRepository': 'utils', 
    'makeMockPrompt': 'utils', 'makeMockHeadIdReader': 'utils', 'makeMockInputResolver': 'utils', 
    'makeMockStalenessDetector': 'utils', 'makeMockValidator': 'utils', 'makeMockProtocolRegistry': 'utils', 
    'makeMockLoreContext': 'utils', 'createLoreProgram': 'utils', 'TestLogger': 'utils', 'buildLoreCli': 'utils',
    'createMockProtocol': 'utils', 'makeQueryOptions': 'utils', 'makeAtomRepository': 'utils',
    'makeLoreProtocol': 'utils', 'makeLoreRegistry': 'utils', 

    // Production Helpers & Real Classes (Directly from Testing Gateway)
    'makeProtocol': 'gateway', 'makeProtocolRegistry': 'gateway', 'makeAtom': 'gateway', 
    'makeTrailers': 'gateway', 'makeRawCommit': 'gateway', 'TEST_PROTOCOL_DEFINITION': 'gateway', 
    'TEST_ENGINE_CONFIG': 'gateway', 'TEST_PROTOCOL_CONFIG': 'gateway', 'TEST_ID_KEY': 'gateway', 
    'TEST_YAP_DEFINITION': 'gateway', 'makeCommitInput': 'gateway', 'makeStubProtocol': 'gateway', 
    'makeStubGitClient': 'gateway', 'makeStubPrompt': 'gateway', 'makeStubFormatter': 'gateway', 
    'makeStubConfigLoader': 'gateway', 'makeStubInputResolver': 'gateway', 'makeStubHeadIdReader': 'gateway', 
    'makeStubAtomRepository': 'gateway', 'makeStubValidator': 'gateway', 'makeStubStalenessDetector': 'gateway', 
    'makeStubProtocolRegistry': 'gateway', 'makeProtocolConfig': 'gateway', 'makeQueryTarget': 'gateway', 
    'assertIsolatedEngine': 'gateway', 'TEST_ENGINE_DIR': 'gateway',
    'ActiveProtocol': 'gateway', 'ProtocolRegistry': 'gateway', 'ProtocolLoader': 'gateway', 
    'AtomRepository': 'gateway', 'Validator': 'gateway', 'StalenessDetector': 'gateway', 
    'NullQueryCache': 'gateway', 'InMemoryLogger': 'gateway', 'ProtocolMap': 'gateway',
    'ProtocolInterpreter': 'gateway', 'ProtocolValidator': 'gateway', 'ProtocolSchema': 'gateway',
    'hydrateAtoms': 'gateway', 'extractReferenceIds': 'gateway', 'resolveSupersession': 'gateway', 
    'generateId': 'gateway', 'parseTrailers': 'gateway', 'serializeTrailers': 'gateway', 
    'filterAtoms': 'gateway', 'resolveFilters': 'gateway', 'createQueryTarget': 'gateway', 
    'createTargetFromIdentities': 'gateway', 'getCacheFingerprint': 'gateway', 'isBlameTarget': 'gateway', 
    'getGitLogArgs': 'gateway', 'getGitBlameArgs': 'gateway', 'evaluateAgeSignal': 'gateway', 'evaluateDriftSignal': 'gateway',
    'resolvePath': 'gateway', 'resolveGitRoot': 'gateway', 'getActiveRoot': 'gateway',
    'evaluateHygiene': 'gateway', 'evaluateProtocolSchema': 'gateway', 'evaluateTrailerHygiene': 'gateway',
    'parseFlagsToInput': 'gateway', 'selectInputMode': 'gateway', 'finalizeCommitInput': 'gateway',
    'squashAtoms': 'gateway', 'ProtocolQueryAdapter': 'gateway', 'filterActiveAtoms': 'gateway',
    'resolveFilterStrings': 'gateway', 'GLOBAL_CACHE_KEY': 'gateway',
    'GitClient': 'gateway', 'QueryCache': 'gateway', 'ConfigLoader': 'gateway',
    'RootResolver': 'gateway', 'DynamicProtocolLoader': 'gateway', 'ProtocolHydrator': 'gateway',
    'TerminalLogger': 'gateway', 'TerminalPrompt': 'gateway', 'JsonInputReader': 'gateway',
    'InteractiveInputReader': 'gateway', 'CommitInputResolver': 'gateway', 'MultiValueTrailerCollector': 'gateway',
    'EnumChoiceTrailerCollector': 'gateway', 'TrailerCollectorRegistry': 'gateway', 'createTrailerCollectors': 'gateway',
    'JsonFormatter': 'gateway', 'TextFormatter': 'gateway', 'EngineBootstrapper': 'gateway',
    'HeadIdReader': 'gateway', 'ENGINE_CONFIG_FILENAME': 'gateway', 'ENGINE_DIR_NAME': 'gateway',
    'TRAILER_UI_KINDS': 'gateway', 'TRAILER_UI_COLORS': 'gateway', 'STALE_SIGNAL': 'gateway',
    'LogLevel': 'gateway', 'DEFAULT_ENGINE_CONFIG': 'gateway', 'LoreProtocolDefinition': 'gateway',
    'LoreConfigLoader': 'gateway', 'LoreTextFormatter': 'gateway', 'LoreJsonFormatter': 'gateway',
    'slugify': 'gateway', 'camelCase': 'gateway', 'snakeCase': 'gateway', 'formatAge': 'gateway',
    'evaluateAgeSignal': 'gateway', 'evaluateDriftSignal': 'gateway', 'parseDuration': 'gateway',
    'getEngineVersion': 'gateway', 'getEnginePackageName': 'gateway', 'getEnginePublishedVersion': 'gateway',
    'checkForUpdates': 'gateway', 'ProtocolError': 'gateway', 'ConfigurationError': 'gateway',
    'formatCommit': 'gateway', 'validateFormatting': 'gateway', 'InputMode': 'gateway',
    'registerInitCommand': 'gateway', 'executeEngineInit': 'gateway', 'executePathQuery': 'gateway',
    'addPathQueryOptions': 'gateway', 'analyzeConfigGaps': 'gateway', 'registerLogCommand': 'gateway',
    'registerCommitCommand': 'gateway', 'registerSearchCommand': 'gateway', 'registerTraceCommand': 'gateway',
    'runCli': 'gateway', 'execute': 'gateway', 'resolveProtocolRoot': 'gateway',

    // Types
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
    'FormattableConfigResult': 'gateway', 'FilterOperator': 'gateway', 'FormattableDoctorResult': 'gateway',
    'DoctorCheck': 'gateway', 'PathQueryDeps': 'gateway', 'PathQueryCommandOptions': 'gateway'
};

for (const file of allFiles) {
    if (file.endsWith('engine-test-utils.ts') || file.endsWith('lore-test-utils.ts')) {
        console.log(`Skipping protected utility file: ${file}`);
        continue;
    }
    
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    const fileDir = path.dirname(file);

    // 1. Identify all symbols used in the file
    const symbolsUsed = new Set();
    for (const sym in mapping) {
        const usageRegex = new RegExp(`\\b${sym}\\b`, 'g');
        if (usageRegex.test(content)) {
            symbolsUsed.add(sym);
        }
    }

    if (symbolsUsed.size === 0) continue;

    // 2. Wipe ALL old engine/lore imports
    const oldImportRegex = /import\s+\{([^}]*)\}\s+from\s+['"]([^'"]*?(engine|lore|src\/engine|test-utils|testing\.js|index\.js)[^'"]*)['"];?/g;
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
    const sortedDests = Object.keys(groups).sort();
    for (const dest of sortedDests) {
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
        console.log(`Mega-Aligned ${file}`);
    }
}
