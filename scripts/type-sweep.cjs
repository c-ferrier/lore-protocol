const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const testDir = path.resolve(process.cwd(), 'tests');

function findTestFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const item of list) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            results = results.concat(findTestFiles(fullPath));
        } else if (fullPath.endsWith('.test.ts') || fullPath.endsWith('.ts')) {
            results.push(fullPath);
        }
    }
    return results;
}

const files = findTestFiles(testDir);

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf-8');
  let original = content;

  // Replace let protocol: any;
  if (content.includes('let protocol: any;') || content.includes('let rootProtocol: any;') || content.includes('let projectProtocol: any;')) {
      content = content.replace(/let protocol: any;/g, 'let protocol: ProtocolContext;');
      content = content.replace(/let rootProtocol: any;/g, 'let rootProtocol: ProtocolContext;');
      content = content.replace(/let projectProtocol: any;/g, 'let projectProtocol: ProtocolContext;');
      
      // Ensure import
      if (!content.includes('ProtocolContext')) {
          const defImport = content.match(/import type \{ (.*) \} from '.*protocol-definition\.js';/);
          if (defImport) {
              if (!defImport[1].includes('ProtocolContext')) {
                  const newImport = defImport[0].replace(/import type \{ (.*) \}/, 'import type { $1, ProtocolContext }');
                  content = content.replace(defImport[0], newImport);
              }
          } else {
             content = "import type { ProtocolContext } from '" + (file.includes('tests/engine/contract/protocol') || file.includes('tests/engine/architecture') ? '../../../../' : (file.includes('tests/engine/contract') || file.includes('tests/engine/logic') || file.includes('tests/lore/logic') || file.includes('tests/lore/contract') ? '../../../' : '../../')) + "src/engine/core/types/protocol-definition.js';\n" + content;
          }
      }
  }

  // Remove `as any` from makeMockContext, registry.register
  content = content.replace(/registry\.register\(([^)]+) as any\)/g, "registry.register($1)");
  content = content.replace(/makeMockContext\(\{(.*?)\} as any\)/gs, "makeMockContext({$1})");

  if (content !== original) {
      fs.writeFileSync(file, content);
      console.log(`Updated ${file}`);
  }
});
