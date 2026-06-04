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
        } else if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
            results.push(filePath);
        }
    });
    return results;
}

const allFiles = [...getFiles('src'), ...getFiles('tests')];

const redirections = [
    [/src\/engine\/services\/protocol\.js/g, 'src/engine/core/models/active-protocol.js'],
    [/src\/engine\/interfaces\/protocol\.js/g, 'src/engine/core/models/active-protocol.js'],
    [/src\/engine\/interfaces\/protocol-definition\.js/g, 'src/engine/core/types/protocol-definition.js'],
    [/src\/engine\/services\/protocol\/protocol-loader\.js/g, 'src/engine/shell/fs/protocol-loader.js'],
    [/src\/engine\/services\/protocol\/protocol-query-adapter\.js/g, 'src/engine/shell/git/protocol-query-adapter.js'],
    [/src\/engine\/services\/protocol\/protocol-interpreter\.js/g, 'src/engine/core/models/active-protocol.js'],
    [/src\/engine\/services\/protocol\/protocol-validator\.js/g, 'src/engine/core/models/active-protocol.js'],
    [/src\/engine\/services\/protocol\/protocol-schema\.js/g, 'src/engine/core/models/active-protocol.js']
];

for (const filePath of allFiles) {
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;

    // 1. Redirect imports
    for (const [pattern, target] of redirections) {
        const newContent = content.replace(pattern, (match) => {
            const fileDir = path.dirname(filePath);
            const targetAbs = path.resolve(process.cwd(), target);
            let rel = path.relative(fileDir, targetAbs).replace(/\\/g, '/');
            if (!rel.startsWith('.')) rel = './' + rel;
            if (rel !== match) {
                changed = true;
                return rel;
            }
            return match;
        });
        content = newContent;
    }

    // 2. Fix Protocol Registry routing failures
    if (content.includes('import { Protocol }') || content.includes('import { Protocol,')) {
        content = content.replace(/import \{ Protocol/g, 'import { ActiveProtocol as Protocol');
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${filePath}`);
    }
}
