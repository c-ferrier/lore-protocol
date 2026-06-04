const fs = require('fs');
const path = require('path');

const files = [
  'tests/engine/architecture/flat-protocol-boundaries.test.ts',
  'tests/engine/contract/namespace-logic.test.ts',
  'tests/engine/contract/filtering-parity.test.ts',
  'tests/engine/contract/head-id-reader.test.ts',
  'tests/engine/contract/formatters/text-formatter.test.ts',
  'tests/engine/contract/formatters/json-formatter.test.ts',
  'tests/lore/logic/protocol.test.ts',
  'tests/lore/logic/validation.test.ts'
];

files.forEach(file => {
  const filePath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(filePath)) return;
  
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // 1. Fix getFormattableDefinitions calls
  content = content.replace(/protocol\.getFormattableDefinitions\(\)/g, 'getFormattableDefinitions(protocol)');
  
  // 2. Ensure normalizeTrailers is imported from testing.js if used
  if (content.includes('normalizeTrailers(') && !content.includes('normalizeTrailers')) {
      content = content.replace(/import \{ (.*) \} from '(.*)\/testing\.js';/, "import { $1, normalizeTrailers } from '$2/testing.js';");
  }

  // 3. Ensure getFormattableDefinitions is imported from protocols.js if used
  if (content.includes('getFormattableDefinitions(protocol)') && !content.includes('getFormattableDefinitions')) {
      content = content.replace(/import \{ (.*) \} from '(.*)\/protocols\.js';/, "import { $1, getFormattableDefinitions } from '$2/protocols.js';");
  }

  // 4. Fix mockAtomRepo usages (some tests use atomRepository.find.mockResolvedValue)
  // Ensure makeMockAtomRepository is used
  
  // 5. Fix head-id-reader tests (gitClient.getHeadMessage.mockResolvedValue)
  if (file.includes('head-id-reader.test.ts')) {
      // Need to use makeMockGitClient
      content = content.replace(/import \{ (.*) \} from '(.*)\/testing\.js';/, "import { $1, makeStubGitClient } from '$2/testing.js';");
      content = content.replace(/import \{ (.*) \} from '(.*)\/engine-test-utils\.js';/, "import { $1, makeMockGitClient } from '$2/engine-test-utils.js';");
      content = content.replace(/gitClient = makeStubGitClient\(\)/, "gitClient = makeMockGitClient()");
  }

  fs.writeFileSync(filePath, content);
  console.log(`Updated ${file}`);
});
