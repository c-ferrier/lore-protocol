const fs = require('fs');
const path = require('path');

function findFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const item of list) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            results = results.concat(findFiles(fullPath));
        } else if (fullPath.endsWith('.ts')) {
            results.push(fullPath);
        }
    }
    return results;
}

const files = findFiles('src').concat(findFiles('tests'));
const report = [];

files.forEach(file => {
    const content = fs.readFileSync(file, 'utf-8');
    const issues = [];
    
    if (content.includes('ActiveProtocol')) issues.push('Contains ActiveProtocol');
    if (content.includes('as any')) issues.push('Contains "as any" cast');
    
    // Check for other potential smells
    if (file.includes('src/engine/core/models/')) issues.push('Model folder in core');
    
    if (issues.length > 0) {
        report.push({ file, issues });
    }
});

console.log(JSON.stringify(report, null, 2));
