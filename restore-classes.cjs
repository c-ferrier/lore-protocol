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

const mapping = [
    { name: 'MultiValueTrailerCollector', path: 'src/engine/cli/readers/collectors/multi-value-trailer-collector.js' },
    { name: 'EnumChoiceTrailerCollector', path: 'src/engine/cli/readers/collectors/enum-choice-trailer-collector.js' },
    { name: 'InteractiveInputReader', path: 'src/engine/cli/readers/interactive-input-reader.js' },
    { name: 'JsonInputReader', path: 'src/engine/cli/readers/json-input-reader.js' },
    { name: 'createTrailerCollectors', path: 'src/engine/cli/readers/collectors/trailer-collector-registry.js' },
    { name: 'LoreConfigLoader', path: 'src/engine/lore/services/lore-config-loader.js' },
    { name: 'LoreTextFormatter', path: 'src/lore/formatters/lore-text-formatter.js' },
    { name: 'LoreJsonFormatter', path: 'src/lore/formatters/lore-json-formatter.js' },
    { name: 'getEnginePackageName', path: 'src/engine/util/version.js' },
    { name: 'getEngineVersion', path: 'src/engine/util/version.js' },
    { name: 'getLoreVersion', path: 'src/lore/util/version.js' },
    { name: 'createBaseFormatter', path: 'src/engine/formatters/index.ts' },
    { name: 'registerContextCommand', path: 'src/engine/cli/commands/context.js' },
    { name: 'registerConstraintsCommand', path: 'src/engine/cli/commands/constraints.js' },
];

for (const file of allFiles) {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    const fileDir = path.dirname(file);

    for (const item of mapping) {
        if (content.includes(item.name) && !content.includes(`import { ${item.name}`)) {
            const targetAbs = path.resolve(process.cwd(), item.path);
            let rel = path.relative(fileDir, targetAbs).replace(/\\/g, '/');
            if (!rel.startsWith('.')) rel = './' + rel;
            
            content = `import { ${item.name} } from '${rel}';\n` + content;
            changed = true;
            console.log(`Added ${item.name} import to ${file}`);
        }
    }

    if (changed) {
        fs.writeFileSync(file, content, 'utf8');
    }
}
