import { beforeEach,describe, expect, it } from 'vitest';

import { AtomRepository } from '../../../src/engine/services/atom-repository.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeAtomRepository,makeStubProtocolContext } from '../../../src/engine/testing.js';
import { makeMockGitClient } from '../engine-test-utils.js';
;
;

;

describe('Git Security (Argument Escaping)', () => {
  let gitClient: any;
  let repository: AtomRepository;
  let registry: ProtocolRegistry;

  beforeEach(() => {
    gitClient = makeMockGitClient();
    registry = new ProtocolRegistry();
    registry.register(makeStubProtocolContext({
        name: 'Mock',
        identityKey: 'Mock-id',
        permissive: true, // Need permissive mode or explicitly defined trailer
        trailers: { 
            'Mock-id': { description: 'ID', multivalue: false, validation: 'none' },
            'Secret: ) | grep': { description: 'Malicious', multivalue: false, validation: 'none' }
        }
    }));
    
    repository = makeAtomRepository({
        gitClient,
        registry
    });
  });

  it('should pass author filter to GitClient.query raw (escaping is Client responsibility)', async () => {
    const maliciousAuthor = 'cole (admin) | rm -rf';
    await repository.find(undefined, { author: maliciousAuthor });
    
    expect(gitClient.query).toHaveBeenCalledWith(expect.objectContaining({
        author: maliciousAuthor
    }));
  });

  it('should escape regex characters in scope filter (handled by Repository)', async () => {
    await repository.find(undefined, { scope: 'ui) | grep (secret' });
    
    const query = gitClient.query.mock.calls[0][0];
    const found = query.regexPatterns.some((set: string[]) => 
        set.some(p => p.includes('ui\\) \\| grep \\(secret'))
    );
    expect(found).toBe(true);
  });

  it('should escape regex characters in atom ID filter (handled by Repository/Adapter)', async () => {
    const maliciousId = 'dead) | beef';
    await repository.findById({ id: maliciousId });
    
    const query = gitClient.query.mock.calls[0][0];
    const found = query.regexPatterns.some((set: string[]) => 
        set.some(p => p.includes('dead\\) \\| beef'))
    );
    expect(found).toBe(true);
  });

  it('should escape regex characters in trailer key search (has filter)', async () => {
    await repository.find(undefined, { has: 'Secret: ) | grep' });
    
    // The 'has' filter should result in an escaped regex pattern starting with ^
    const query = gitClient.query.mock.calls[0][0];
    const found = query.regexPatterns.some((set: string[]) => 
        set.some(p => p.includes('^Secret: \\) \\| grep: '))
    );
    expect(found).toBe(true);
  });
});