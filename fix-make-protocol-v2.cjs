const fs = require('fs');
const path = require('path');

const files = [
    'tests/engine/system/multi-target-discovery.test.ts',
    'tests/engine/contract/cross-protocol-validation.test.ts',
    'tests/lore/logic/protocol.test.ts',
    'tests/engine/contract/doctor.test.ts',
    'tests/engine/architecture/rebranding-flow.test.ts',
    'tests/lore/contract/formatters/lore-json-formatter.test.ts',
    'tests/lore/logic/validation.test.ts',
    'tests/lore/contract/formatters/lore-text-formatter.test.ts',
    'tests/engine/system/git-discovery.test.ts',
    'tests/lore/architecture/rebranding-flow.test.ts',
    'tests/lore/logic/protocol-definition.test.ts'
];

for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, 'utf8');
    
    // Check if makeProtocol is already imported
    if (content.includes('makeProtocol')) continue;

    // Try to find the import from engine-test-utils.js or lore-test-utils.js
    const importRegex = /import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]*?-test-utils\.js)['"]/g;
    
    let changed = false;
    const newContent = content.replace(importRegex, (match, imports, utilsPath) => {
        changed = true;
        // Clean up whitespace and newlines
        let cleanedImports = imports.trim().replace(/\s+/g, ' ');
        return `import { makeProtocol, ${cleanedImports} } from '${utilsPath}'`;
    });
    
    if (changed) {
        fs.writeFileSync(file, newContent, 'utf8');
        console.log(`Fixed makeProtocol in ${file}`);
    } else {
        // Fallback: try to add it after the first import line if no utils found
        const firstImportEnd = content.indexOf('\n', content.indexOf('import'));
        if (firstImportEnd !== -1) {
            const utilsPath = file.includes('tests/lore/') ? '../lore-test-utils.js' : '../engine-test-utils.js';
            content = `import { makeProtocol } from '${utilsPath}';\n` + content;
            fs.writeFileSync(file, content, 'utf8');
            console.log(`Added makeProtocol fallback to ${file}`);
        }
    }
}
