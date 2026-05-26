import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';

describe('Git Security (Argument Escaping)', () => {
  let gitClient: any;
  let repository: AtomRepository;

  beforeEach(() => {
    gitClient = {
      log: vi.fn().mockResolvedValue([]),
      resolveRef: vi.fn().mockResolvedValue('head'),
      getFilesChanged: vi.fn().mockResolvedValue(new Map()),
    };
    
    // We only care about the gitClient.log arguments in this test
    repository = new AtomRepository(
      gitClient,
      {} as any,
      undefined,
      new ProtocolRegistry(),
      { filter: vi.fn((a) => a) } as any,
      { get: vi.fn(), set: vi.fn() } as any,
      { get: vi.fn(), set: vi.fn() } as any,
    );
  });

  it('should escape regex characters in author filter', async () => {
    await repository.findAll({ author: 'cole (admin) | rm -rf' });
    
    const callArgs = gitClient.log.mock.calls[0][0];
    const authorArg = callArgs.find((a: string) => a.startsWith('--author='));
    
    // The parens and pipe should be escaped
    expect(authorArg).toContain('cole \\(admin\\) \\| rm -rf');
  });

  it('should escape regex characters in discovery patterns', async () => {
     // If a malicious protocol provides a pattern with unescaped pipes
     const mockProtocol: any = {
         name: 'malicious',
         getDiscoveryPattern: () => 'Lore-id: [0-9a-f]{8})|.*',
         getDiscoveryGrep: () => ['--grep=Lore-id: [0-9a-f]{8})|.*']
     };
     
     // Currently we trust the protocol to return valid grep args via getDiscoveryGrep,
     // but we should verify our aggregator in ProtocolRegistry or Repository handles it.
     
     // Let's check how AtomRepository aggregates greps.
  });
});
