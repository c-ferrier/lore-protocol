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

const testingGatewayAbs = path.resolve(process.cwd(), 'src/engine/testing.js');
const engineIndexAbs = path.resolve(process.cwd(), 'src/engine/index.js');

for (const file of allFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    const fileDir = path.dirname(file);

    // 1. Direct Import Strategy: Move all engine helpers to import from src/engine/testing.js
    // This bypasses the circular/shadowing issues in engine-test-utils.ts
    const engineHelpers = [
        'makeProtocol', 'makeProtocolRegistry', 'makeAtom', 'makeTrailers', 'makeRawCommit',
        'TEST_PROTOCOL_DEFINITION', 'TEST_ENGINE_CONFIG', 'TEST_PROTOCOL_CONFIG', 'TEST_ID_KEY',
        'makeMockGitClient', 'makeMockProtocol', 'makeMockPrompt', 'makeMockFormatter',
        'makeMockAtomRepository', 'makeMockConfigLoader', 'makeMockInputResolver',
        'makeStubProtocol', 'makeStubGitClient', 'makeStubPrompt', 'makeStubFormatter'
    ];

    // Find imports from engine-test-utils.js
    const utilsRegex = /import\s+\{([^}]*)\}\s+from\s+['"]([^'"]*?engine-test-utils\.js)['"]/g;
    content = content.replace(utilsRegex, (match, imports, oldPath) => {
        const importedList = imports.split(',').map(s => s.trim());
        const toMove = importedList.filter(s => engineHelpers.includes(s));
        const toStay = importedList.filter(s => !engineHelpers.includes(s));

        if (toMove.length === 0) return match;

        changed = true;
        const gatewayRel = path.relative(fileDir, testingGatewayAbs).replace(/\\/g, '/');
        const gatewayImport = `import { ${toMove.join(', ')} } from '${gatewayRel.startsWith('.') ? gatewayRel : './' + gatewayRel}'`;
        
        if (toStay.length === 0) return gatewayImport;
        return `import { ${toStay.join(', ')} } from '${oldPath}'\n${gatewayImport}`;
    });

    // 2. Fix broken index imports (common in lore tests)
    const indexRegex = /from\s+['"]([^'"]*?src\/engine\/index\.js)['"]/g;
    content = content.replace(indexRegex, (match, oldPath) => {
        const indexRel = path.relative(fileDir, engineIndexAbs).replace(/\\/g, '/');
        const newPath = indexRel.startsWith('.') ? indexRel : './' + indexRel;
        if (newPath !== oldPath) {
            changed = true;
            return `from '${newPath}'`;
        }
        return match;
    });

    if (changed) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Directly aligned imports in ${file}`);
    }
}
