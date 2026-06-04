const fs = require('fs');
const path = require('path');

const files = [
    'tests/lore/contract/formatters/lore-text-formatter.test.ts',
    'tests/engine/contract/staleness-detector.test.ts',
    'tests/engine/contract/namespace-logic.test.ts',
    'tests/engine/contract/query-cache-fidelity.test.ts',
    'tests/engine/contract/commit-amend.test.ts',
    'tests/engine/contract/validator.test.ts',
    'tests/engine/contract/strict-namespaced-validation.test.ts',
    'tests/engine/contract/trace.test.ts',
    'tests/engine/contract/protocol.test.ts',
    'tests/engine/contract/atom-repository.test.ts',
    'tests/engine/contract/commit-validation.test.ts',
    'tests/engine/contract/atom-hydrator.test.ts',
    'tests/engine/system/multi-target-discovery.test.ts',
    'tests/engine/system/git-discovery.test.ts',
    'tests/engine/logic/atom-repository-optimization.test.ts',
    'tests/engine/logic/commit-formatting.test.ts',
    'tests/engine/logic/squashing.test.ts',
    'tests/engine/logic/input-interpretation.test.ts',
    'tests/engine/logic/validation.test.ts',
    'tests/engine/logic/flags-interpretation.test.ts',
    'tests/engine/contract/cross-protocol-validation.test.ts'
];

for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, 'utf8');
    
    if (content.includes('makeProtocol')) {
        // Ensure it's imported
        if (!content.includes('import { makeProtocol') && !content.includes(', makeProtocol')) {
             const utilsPath = file.includes('tests/lore/') ? '-test-utils.js' : 'engine-test-utils.js';
             content = content.replace(new RegExp(`import \\{([\\s\\S]*?)\\}\\s+from\\s+['"][^'"]*?${utilsPath}['"]`, 'g'), (match, imports) => {
                 return `import { makeProtocol, ${imports.trim()} } from '${utilsPath.includes('engine') ? '../engine-test-utils.js' : '../lore-test-utils.js'}'`;
             });
             fs.writeFileSync(file, content, 'utf8');
             console.log(`Fixed import in ${file}`);
        }
    }
}
