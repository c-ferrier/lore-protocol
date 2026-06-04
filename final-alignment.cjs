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

const allFiles = [...getFiles('tests'), ...getFiles('src')];

const engineUtilsAbs = path.resolve(process.cwd(), 'tests/engine/engine-test-utils.js');
const loreUtilsAbs = path.resolve(process.cwd(), 'tests/lore/lore-test-utils.js');
const testingGatewayAbs = path.resolve(process.cwd(), 'src/engine/testing.js');
const engineIndexAbs = path.resolve(process.cwd(), 'src/engine/index.js');

for (const file of allFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    const fileDir = path.dirname(file);

    // 1. Repair Utils Imports
    const utilsRegex = /import\s+\{([^}]*)\}\s+from\s+['"]([^'"]*?-test-utils\.js)['"]/g;
    content = content.replace(utilsRegex, (match, imports, oldPath) => {
        const targetAbs = file.includes('tests/lore/') ? loreUtilsAbs : engineUtilsAbs;
        let rel = path.relative(fileDir, targetAbs).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = './' + rel;
        
        if (rel !== oldPath) {
            changed = true;
            return `import { ${imports} } from '${rel}'`;
        }
        return match;
    });

    // 2. Repair Engine Index/Testing Imports
    const engineRegex = /from\s+['"]([^'"]*?src\/engine\/(index|testing)\.js)['"]/g;
    content = content.replace(engineRegex, (match, oldPath, type) => {
        const targetAbs = type === 'index' ? engineIndexAbs : testingGatewayAbs;
        let rel = path.relative(fileDir, targetAbs).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = './' + rel;
        
        if (rel !== oldPath) {
            changed = true;
            return `from '${rel}'`;
        }
        return match;
    });

    // 3. Repair Deep ActiveProtocol Imports (often broken by previous scripts)
    const activeProtocolAbs = path.resolve(process.cwd(), 'src/engine/core/models/active-protocol.js');
    const apRegex = /from\s+['"]([^'"]*?active-protocol\.js)['"]/g;
    content = content.replace(apRegex, (match, oldPath) => {
        let rel = path.relative(fileDir, activeProtocolAbs).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = './' + rel;
        
        if (rel !== oldPath) {
            changed = true;
            return `from '${rel}'`;
        }
        return match;
    });

    // 4. Fix ProtocolRegistry Imports
    const registryAbs = path.resolve(process.cwd(), 'src/engine/services/protocol-registry.js');
    const prRegex = /from\s+['"]([^'"]*?protocol-registry\.js)['"]/g;
    content = content.replace(prRegex, (match, oldPath) => {
        let rel = path.relative(fileDir, registryAbs).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = './' + rel;
        
        if (rel !== oldPath) {
            changed = true;
            return `from '${rel}'`;
        }
        return match;
    });

    if (changed) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Aligned imports in ${file}`);
    }
}
