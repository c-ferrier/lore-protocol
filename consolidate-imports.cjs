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

// Comprehensive list of EVERY symbol we need to route
const allManagedSymbols = [
    'makeMockGitClient', 'makeMockProtocol', 'makeMockPrompt', 'makeMockFormatter',
    'makeMockAtomRepository', 'makeMockConfigLoader', 'makeMockInputResolver',
    'makeMockHeadIdReader', 'makeMockStalenessDetector', 'makeMockValidator',
    'makeMockProtocolRegistry', 'makeMockLoreContext', 'createLoreProgram', 'TestLogger',
    'makeProtocol', 'makeProtocolRegistry', 'makeAtom', 'makeTrailers', 'makeRawCommit',
    'TEST_PROTOCOL_DEFINITION', 'TEST_ENGINE_CONFIG', 'TEST_PROTOCOL_CONFIG', 'TEST_ID_KEY',
    'TEST_YAP_DEFINITION', 'makeCommitInput', 'makeStubProtocol', 'makeStubGitClient',
    'makeStubPrompt', 'makeStubFormatter', 'makeStubConfigLoader', 'makeStubInputResolver',
    'makeStubHeadIdReader', 'makeStubAtomRepository', 'makeStubValidator',
    'makeStubStalenessDetector', 'makeStubProtocolRegistry', 'makeProtocolConfig',
    'makeQueryTarget', 'assertIsolatedEngine', 'TEST_ENGINE_DIR', 'makeQueryOptions',
    'makeLoreProtocol', 'makeLoreRegistry', 'makeAtomRepository',
    'ActiveProtocol', 'ProtocolRegistry', 'ProtocolLoader', 
    'AtomRepository', 'Validator', 'StalenessDetector', 
    'NullQueryCache', 'InMemoryLogger', 'ProtocolMap',
    'ProtocolInterpreter', 'ProtocolValidator', 'ProtocolSchema',
    'hydrateAtoms', 'extractReferenceIds', 'resolveSupersession', 
    'generateId', 'parseTrailers', 'serializeTrailers', 
    'filterAtoms', 'resolveFilters', 'createQueryTarget', 
    'createTargetFromIdentities', 'getCacheFingerprint', 'isBlameTarget', 
    'getGitLogArgs', 'getGitBlameArgs', 'evaluateAgeSignal', 'evaluateDriftSignal',
    'resolvePath', 'resolveGitRoot', 'getActiveRoot',
    'evaluateHygiene', 'evaluateProtocolSchema', 'evaluateTrailerHygiene',
    'parseFlagsToInput', 'selectInputMode', 'finalizeCommitInput',
    'squashAtoms', 'ProtocolQueryAdapter', 'filterActiveAtoms',
    'resolveFilterStrings', 'GLOBAL_CACHE_KEY',
    'LoreProtocolDefinition',
    'GitClient', 'QueryCache', 'ConfigLoader', 'RootResolver',
    'DynamicProtocolLoader', 'ProtocolHydrator', 'TerminalLogger',
    'TerminalPrompt', 'JsonInputReader', 'InteractiveInputReader',
    'CommitInputResolver', 'MultiValueTrailerCollector', 'EnumChoiceTrailerCollector',
    'createTrailerCollectors', 'TrailerCollectorRegistry', 'LoreConfigLoader',
    'LoreTextFormatter', 'LoreJsonFormatter', 'registerCommitCommand',
    'registerLogCommand', 'registerSearchCommand', 'registerContextCommand',
    'registerConstraintsCommand', 'executePathQuery', 'addPathQueryOptions',
    'mergeOptions', 'ProtocolError', 'ConfigurationError',
    'getEngineVersion', 'getEnginePackageName', 'getLoreVersion',
    'ProtocolName', 'Atom', 'Trailers', 'HierarchicalTrailers', 
    'ProtocolState', 'SupersessionStatus', 'StaleReason', 'StaleSignal', 
    'IGitClient', 'RawCommit', 'CommitResult', 'BlameLine', 
    'IQueryCache', 'IOutputFormatter', 'ErrorMessage', 
    'ProtocolDefinition', 'EngineConfig', 'ProtocolConfig', 
    'TrailerUiKind', 'TrailerUiColor', 'TrailerDefinition', 
    'CommitInput', 'ValidationIssue', 'FormattableTrailerDefinition', 
    'QualifiedFilter', 'SearchOptions', 'QueryTargetAST', 
    'QueryIdentity', 'IConfigLoader', 'IPrompt', 
    'ICommitInputReader', 'PathQueryOptions', 'StaleIfCondition',
    'FormattableQueryResult', 'FormattableValidationResult', 
    'FormattableStalenessResult', 'FormattableTraceResult', 
    'FormattableConfigResult', 'FilterOperator', 'FormattableDoctorResult',
    'DoctorCheck', 'PathQueryDeps', 'PathQueryCommandOptions'
];

for (const file of allFiles) {
    if (file.endsWith('engine-test-utils.ts') || file.endsWith('lore-test-utils.ts')) continue;
    
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    const fileDir = path.dirname(file);

    // 1. Identify all symbols used in the file
    const symbolsUsed = new Set();
    for (const sym of allManagedSymbols) {
        const usageRegex = new RegExp(`\\b${sym}\\b`, 'g');
        if (usageRegex.test(content)) {
            symbolsUsed.add(sym);
        }
    }

    if (symbolsUsed.size === 0) continue;

    // 2. Wipe ALL old engine/lore imports
    const oldImportRegex = /import\s+\{([^}]*)\}\s+from\s+['"]([^'"]*?(engine|lore|src\/engine|testing\.js|index\.js|test-utils)[^'"]*)['"];?/g;
    content = content.replace(oldImportRegex, '');
    content = content.trim();

    // 3. Re-group all symbols to use the SINGLE MIDDLEMAN UTILS
    const targetAbs = file.includes('tests/lore/') ? loreUtilsAbs : engineUtilsAbs;
    let rel = path.relative(fileDir, targetAbs).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = './' + rel;
    
    const sortedSyms = Array.from(symbolsUsed).sort();
    const newImport = `import { ${sortedSyms.join(', ')} } from '${rel}';\n\n`;

    content = newImport + content;
    changed = true;

    if (changed) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Consolidated all imports in ${file}`);
    }
}
