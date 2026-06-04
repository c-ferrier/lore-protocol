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

const testFiles = getFiles('tests');
const srcFiles = getFiles('src');
const allFiles = [...testFiles, ...srcFiles];

const engineUtilsAbs = path.resolve(process.cwd(), 'tests/engine/engine-test-utils.js');
const loreUtilsAbs = path.resolve(process.cwd(), 'tests/lore/lore-test-utils.js');
const activeProtocolAbs = path.resolve(process.cwd(), 'src/engine/core/models/active-protocol.js');
const registryAbs = path.resolve(process.cwd(), 'src/engine/services/protocol-registry.js');
const errorsAbs = path.resolve(process.cwd(), 'src/engine/util/errors.js');

for (const file of allFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    const fileDir = path.dirname(file);

    // 1. Fix Utils Imports
    const utilsRegex = /import\s+\{([^}]*)\}\s+from\s+['"]([^'"]*?-test-utils\.js)['"]/g;
    content = content.replace(utilsRegex, (match, imports, oldPath) => {
        const targetAbs = file.includes('tests/lore/') ? loreUtilsAbs : engineUtilsAbs;
        let rel = path.relative(fileDir, targetAbs).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = './' + rel;
        
        // Ensure makeProtocol is included if the file uses it
        let newImports = imports;
        if (content.includes('makeProtocol(') && !imports.includes('makeProtocol')) {
            newImports = `makeProtocol, ${imports.trim()}`;
        }
        
        changed = true;
        return `import { ${newImports} } from '${rel}'`;
    });

    // 2. Fix ActiveProtocol Imports
    const apRegex = /import\s+\{([^}]*ActiveProtocol[^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
    content = content.replace(apRegex, (match, imports, oldPath) => {
        let rel = path.relative(fileDir, activeProtocolAbs).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = './' + rel;
        changed = true;
        return `import { ${imports} } from '${rel}'`;
    });

    // 3. Fix ProtocolRegistry Imports
    const prRegex = /import\s+\{([^}]*ProtocolRegistry[^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
    content = content.replace(prRegex, (match, imports, oldPath) => {
        let rel = path.relative(fileDir, registryAbs).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = './' + rel;
        changed = true;
        return `import { ${imports} } from '${rel}'`;
    });

    // 4. Fix ProtocolError Imports
    if (content.includes('ProtocolError') && !content.includes('import { ProtocolError')) {
        let rel = path.relative(fileDir, errorsAbs).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = './' + rel;
        content = `import { ProtocolError } from '${rel}';\n` + content;
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Standardized imports in ${file}`);
    }
}
