import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { PathResolver } from '../../../src/engine/services/path-resolver.js';
import { makeAtomRepository } from '../engine-test-utils.js';

describe('Git Security (Argument Escaping)', () => {
  let gitClient: any;
  let repository: AtomRepository;

  beforeEach(() => {
    gitClient = {
      log: vi.fn().mockResolvedValue([]),
      resolveRef: vi.fn().mockResolvedValue('head'),
      getFilesChanged: vi.fn().mockResolvedValue(new Map()),
      resolveDate: vi.fn().mockImplementation(async (d) => new Date(d)),
    };
    
    // We only care about the gitClient.log arguments in this test
    repository = makeAtomRepository({
        gitClient,
        registry: new ProtocolRegistry()
    });
  });

  it('should escape regex characters in author filter', async () => {
    await repository.find({ author: 'cole (admin) | rm -rf' });
    
    const callArgs = gitClient.log.mock.calls[0][0];
    const authorArg = callArgs.find((a: string) => a.startsWith('--author='));
    
    // The parens and pipe should be escaped
    expect(authorArg).toContain('cole \\(admin\\) \\| rm -rf');
  });

  it('should escape regex characters in discovery patterns', async () => {
     // Implementation detail check
  });
});
