const fs = require('fs');
const path = require('path');

const files = [
  'tests/lore/logic/validation.test.ts',
  'tests/lore/logic/protocol.test.ts',
  'tests/engine/contract/commit-input-resolver.test.ts',
  'tests/engine/contract/formatters/text-formatter.test.ts',
  'tests/engine/contract/formatters/json-formatter.test.ts',
  'tests/engine/contract/filtering-parity.test.ts',
  'tests/engine/contract/head-id-reader.test.ts'
];

for (const file of files) {
  const filePath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(filePath)) continue;
  
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // 1. Remove import { ActiveProtocol }
  content = content.replace(/import\s+\{\s*ActiveProtocol\s*\}\s+from\s+['"][^'"]+['"];?\n?/g, '');
  
  // 2. Replace type annotations
  content = content.replace(/:\s*ActiveProtocol/g, ': ProtocolContext');
  
  // Ensure ProtocolContext is imported
  if (content.includes('ProtocolContext') && !content.includes('ProtocolContext } from')) {
    content = "import type { ProtocolContext } from '" + (file.includes('tests/engine/contract/formatters') || file.includes('tests/engine/architecture') ? '../../../../' : (file.includes('tests/engine/contract') || file.includes('tests/engine/logic') || file.includes('tests/lore/logic') || file.includes('tests/lore/contract') ? '../../../' : '../../')) + "src/engine/core/types/protocol-definition.js';\n" + content;
  }

  fs.writeFileSync(filePath, content);
  console.log('Updated ' + file);
}

// Update src/engine/testing.ts
const testingTsPath = path.resolve(process.cwd(), 'src/engine/testing.ts');
let testingTsContent = fs.readFileSync(testingTsPath, 'utf-8');
testingTsContent = testingTsContent.replace(/\* Replaces the legacy ActiveProtocol factory\./g, '* Replaces the legacy protocol factory.');
fs.writeFileSync(testingTsPath, testingTsContent);
console.log('Updated src/engine/testing.ts');

