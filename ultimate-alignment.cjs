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
const engineIndexAbs = path.resolve(process.cwd(), 'src/engine/index.js');

const mockHelpers = [
    'makeMockGitClient', 'makeMockProtocol', 'makeMockPrompt', 'makeMockFormatter',
    'makeMockAtomRepository', 'makeMockConfigLoader', 'makeMockInputResolver',
    'makeMockHeadIdReader', 'makeMockStalenessDetector', 'makeMockValidator',
    'makeMockProtocolRegistry', 'makeMockLoreContext', 'createLoreProgram', 'TestLogger'
];

const engineHelpers = [
    'makeProtocol', 'makeProtocolRegistry', 'makeAtom', 'makeTrailers', 'makeRawCommit',
    'TEST_PROTOCOL_DEFINITION', 'TEST_ENGINE_CONFIG', 'TEST_PROTOCOL_CONFIG', 'TEST_ID_KEY',
    'TEST_YAP_DEFINITION', 'makeCommitInput', 'makeStubProtocol', 'makeStubGitClient',
    'makeStubPrompt', 'makeStubFormatter', 'makeStubConfigLoader', 'makeStubInputResolver',
    'makeStubHeadIdReader', 'makeStubAtomRepository', 'makeStubValidator',
    'makeStubStalenessDetector', 'makeStubProtocolRegistry', 'makeProtocolConfig',
    'makeQueryTarget', 'assertIsolatedEngine', 'TEST_ENGINE_DIR', 'hydrateAtoms',
    'extractReferenceIds', 'resolveSupersession', 'generateId', 'parseTrailers',
    'serializeTrailers', 'filterAtoms', 'resolveFilters', 'createQueryTarget',
    'createTargetFromIdentities', 'getCacheFingerprint', 'isBlameTarget',
    'getGitLogArgs', 'getGitBlameArgs', 'evaluateStaleness', 'getDrift'
];

const types = [
    'ProtocolName', 'Atom', 'Trailers', 'HierarchicalTrailers', 'ProtocolState',
    'SupersessionStatus', 'StaleReason', 'StaleSignal', 'IGitClient', 'RawCommit',
    'CommitResult', 'BlameLine', 'IQueryCache', 'IOutputFormatter', 'ErrorMessage',
    'ProtocolDefinition', 'EngineConfig', 'ProtocolConfig', 'TrailerUiKind',
    'TrailerUiColor', 'TrailerDefinition', 'CommitInput', 'ValidationIssue',
    'FormattableTrailerDefinition', 'QualifiedFilter', 'SearchOptions',
    'QueryTargetAST', 'QueryIdentity', 'IConfigLoader', 'IPrompt', 'ICommitInputReader',
    'PathQueryOptions', 'StaleIfCondition', 'FormattableQueryResult', 
    'FormattableValidationResult', 'FormattableStalenessResult', 'FormattableTraceResult',
    'FormattableConfigResult'
];

const coreClasses = [
    'ProtocolRegistry', 'AtomRepository', 'Validator', 'StalenessDetector', 
    'ActiveProtocol', 'Protocol', 'ProtocolLoader', 'NullQueryCache', 'InMemoryLogger',
    'ProtocolMap', 'DynamicProtocolLoader', 'EngineBootstrapper', 'GitClient',
    'QueryCache', 'TerminalLogger', 'TerminalPrompt', 'CommitInputResolver'
];

for (const file of allFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    const fileDir = path.dirname(file);

    // 1. Identify all imported symbols from engine/lore sources
    const allSymbols = new Set();
    const importRegex = /import\s+\{([^}]*)\}\s+from\s+['"]([^'"]*?(engine|lore|src\/engine)[^'"]*)['"]/g;
    
    // First pass: collect symbols
    let match;
    while ((match = importRegex.exec(content)) !== null) {
        match[1].split(',').forEach(s => {
            const sym = s.trim().split(/\s+as\s+/)[0];
            if (sym) allSymbols.add(sym);
        });
    }

    if (allSymbols.size === 0) continue;

    // 2. Clear old engine/lore imports
    content = content.replace(importRegex, '');
    content = content.trim();

    // 3. Categorize symbols and build new import lines
    const currentMocks = [];
    const currentEngine = [];
    const currentTypes = [];
    const currentClasses = [];

    for (const sym of allSymbols) {
        if (mockHelpers.includes(sym)) currentMocks.push(sym);
        else if (engineHelpers.includes(sym)) currentEngine.push(sym);
        else if (types.includes(sym)) currentTypes.push(sym);
        else if (coreClasses.includes(sym)) currentClasses.push(sym);
        else currentClasses.push(sym); // Fallback to classes
    }

    const newImports = [];

    // Utils (Mocks + Helpers)
    if (currentMocks.length > 0 || currentEngine.length > 0) {
        const targetAbs = file.includes('tests/lore/') ? loreUtilsAbs : engineUtilsAbs;
        let rel = path.relative(fileDir, targetAbs).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = './' + rel;
        newImports.push(`import { ${[...currentMocks, ...currentEngine].join(', ')} } from '${rel}';`);
    }

    // Index (Classes + Types)
    if (currentClasses.length > 0 || currentTypes.length > 0) {
        let rel = path.relative(fileDir, testingGatewayAbs).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = './' + rel;
        newImports.push(`import { ${[...currentClasses, ...currentTypes].join(', ')} } from '${rel}';`);
    }

    if (newImports.length > 0) {
        content = newImports.join('\n') + '\n\n' + content;
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Fully aligned ${file}`);
    }
}
