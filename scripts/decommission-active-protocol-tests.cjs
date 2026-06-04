const fs = require('fs');
const path = require('path');

const files = [
  'tests/lore/logic/validation.test.ts',
  'tests/lore/logic/protocol.test.ts',
  'tests/engine/contract/commit-input-resolver.test.ts',
  'tests/engine/contract/filtering-parity.test.ts',
  'tests/engine/contract/head-id-reader.test.ts',
  'tests/engine/contract/namespace-logic.test.ts',
  'tests/engine/contract/formatters/text-formatter.test.ts',
  'tests/engine/contract/formatters/json-formatter.test.ts',
  'tests/engine/architecture/flat-protocol-boundaries.test.ts'
];

files.forEach(file => {
  const filePath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(filePath)) return;
  
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // 1. Fix imports
  content = content.replace(/import \{ .*ActiveProtocol.* \} from '.*active-protocol\.js';\n?/g, '');
  content = content.replace(/ActiveProtocol,?\s*/g, '');
  content = content.replace(/makeProtocol,?\s*/g, 'makeProtocol, ');
  
  // 2. Replace type annotations
  content = content.replace(/: ActiveProtocol/g, ': any');
  
  // 3. Fix method calls
  content = content.replace(/protocol\.getFormattableDefinitions\(\)/g, 'getFormattableDefinitions(protocol)');
  content = content.replace(/protocol\.getAuthorizedKeys\(\)/g, 'getAuthorizedKeys(protocol)');
  content = content.replace(/protocol\.getScalarKeys\(\)/g, 'getScalarKeys(protocol)');
  content = content.replace(/protocol\.getListKeys\(\)/g, 'getListKeys(protocol)');
  
  // Fix protocol.parse(raw) -> normalizeTrailers(TriggerParser.parseTrailers(raw), protocol)
  content = content.replace(/([a-zA-Z0-9]+)\.parse\(([^)]+)\)/g, "normalizeTrailers(TriggerParser.parseTrailers($2), $1)");
  
  // Fix protocol.validateState(state) -> validateState(protocol, state)
  content = content.replace(/([a-zA-Z0-9]+)\.validateState\(([^)]+)\)/g, "validateState($1, $2)");

  // 4. Ensure imports are present in the import block
  const testingImport = content.match(/import \{ (.*) \} from '(.*)\/testing\.js';/);
  if (testingImport) {
      let imports = testingImport[1].split(',').map(s => s.trim());
      if (content.includes('normalizeTrailers(') && !imports.includes('normalizeTrailers')) imports.push('normalizeTrailers');
      if (content.includes('getAuthorizedKeys(') && !imports.includes('getAuthorizedKeys')) imports.push('getAuthorizedKeys');
      if (content.includes('getScalarKeys(') && !imports.includes('getScalarKeys')) imports.push('getScalarKeys');
      if (content.includes('getListKeys(') && !imports.includes('getListKeys')) imports.push('getListKeys');
      
      const newImport = `import { ${imports.filter(s => s !== '').join(', ')} } from '${testingImport[2]}/testing.js';`;
      content = content.replace(testingImport[0], newImport);
  }

  const utilImport = content.match(/import \{ (.*) \} from '(.*)\/trigger-parser\.js';/);
  if (content.includes('TriggerParser') && !utilImport) {
      content = "import { TriggerParser } from '" + (file.includes('tests/engine') ? '../../../' : '../../') + "src/engine/util/trigger-parser.js';\n" + content;
  }

  const validationImport = content.match(/import \{ (.*) \} from '(.*)\/validation\.js';/);
  if (content.includes('validateState(')) {
      if (validationImport) {
          let imports = validationImport[1].split(',').map(s => s.trim());
          if (!imports.includes('validateState')) imports.push('validateState');
          const newImport = `import { ${imports.filter(s => s !== '').join(', ')} } from '${validationImport[2]}/validation.js';`;
          content = content.replace(validationImport[0], newImport);
      } else {
          content = "import { validateState } from '" + (file.includes('tests/engine') ? '../../../' : '../../') + "src/engine/core/logic/validation.js';\n" + content;
      }
  }

  // Final cleanup
  content = content.replace(/\{ \s*,/g, '{ ').replace(/,\s*,/g, ',').replace(/,\s*\}/g, ' }');

  fs.writeFileSync(filePath, content);
  console.log(`Updated ${file}`);
});
