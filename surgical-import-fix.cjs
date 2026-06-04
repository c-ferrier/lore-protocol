const fs = require('fs');
const path = require('path');

function getFiles(dir) {
    let results = [];
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

for (const file of allFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;

    // 1. Remove makeProtocol from Vitest imports
    if (content.includes("from 'vitest'")) {
        const newContent = content.replace(/import\s+\{([^}]*makeProtocol[^}]*)\}\s+from\s+'vitest'/g, (match, imports) => {
            changed = true;
            let cleaned = imports.split(',').map(s => s.trim()).filter(s => s !== 'makeProtocol').join(', ');
            return `import { ${cleaned} } from 'vitest'`;
        });
        content = newContent;
    }

    // 2. Ensure makeProtocol is in the correct utils import
    if (content.includes('makeProtocol') && !content.includes(", makeProtocol")) {
        const utilsPath = file.includes('tests/lore/') ? 'lore-test-utils.js' : 'engine-test-utils.js';
        const utilsRegex = new RegExp(`import\\s+\\{([^}]*)\\}\\s+from\\s+'([^']*${utilsPath})'`, 'g');
        
        if (utilsRegex.test(content)) {
            content = content.replace(utilsRegex, (match, imports, path) => {
                if (imports.includes('makeProtocol')) return match;
                changed = true;
                return `import { makeProtocol, ${imports.trim()} } from '${path}'`;
            });
        }
    }

    if (changed) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Surgically fixed imports in ${file}`);
    }
}
