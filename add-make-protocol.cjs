const fs = require('fs');
const path = require('path');

const files = [
    'tests/lore/contract/formatters/lore-text-formatter.test.ts',
    'tests/lore/contract/formatters/lore-json-formatter.test.ts',
    'tests/lore/architecture/rebranding-flow.test.ts',
    'tests/lore/logic/protocol-definition.test.ts',
    'tests/lore/logic/protocol.test.ts',
    'tests/lore/logic/validation.test.ts',
    'tests/engine/contract/staleness-detector.test.ts',
    'tests/engine/contract/namespace-logic.test.ts',
    'tests/engine/contract/query-cache-fidelity.test.ts',
    'tests/engine/contract/commit-amend.test.ts',
    'tests/engine/contract/validator.test.ts',
    'tests/engine/contract/strict-namespaced-validation.test.ts',
    'tests/engine/contract/trace.test.ts',
    'tests/engine/contract/protocol.test.ts',
    'tests/engine/contract/atom-repository.test.ts',
    'tests/engine/contract/doctor.test.ts',
    'tests/engine/contract/atom-hydrator.test.ts',
    'tests/engine/architecture/rebranding-flow.test.ts',
    'tests/engine/system/multi-target-discovery.test.ts',
    'tests/engine/system/git-discovery.test.ts',
    'tests/engine/logic/atom-repository-optimization.test.ts',
    'tests/engine/logic/commit-formatting.test.ts',
    'tests/engine/logic/squashing.test.ts',
    'tests/engine/logic/input-interpretation.test.ts',
    'tests/engine/logic/validation.test.ts',
    'tests/engine/logic/flags-interpretation.test.ts'
];

for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, 'utf8');
    
    // Find engine-test-utils.js or lore-test-utils.js import
    const importRegex = /import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]*?-test-utils\.js)['"]/g;
    
    let changed = false;
    const newContent = content.replace(importRegex, (match, imports, utilsPath) => {
        if (imports.includes('makeProtocol')) return match;
        changed = true;
        return `import { makeProtocol, ${imports.trim()} } from '${utilsPath}'`;
    });
    
    if (changed) {
        fs.writeFileSync(file, newContent, 'utf8');
        console.log(`Added makeProtocol to ${file}`);
    }
}
