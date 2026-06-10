import { beforeEach,describe, expect, it } from 'vitest';

import { ProtocolMap } from '../../../src/engine/core/models/protocol-map.js';
import { findAtomById,findAtoms } from '../../../src/engine/shell/orchestrators/discovery.js';
import { makeStubProtocolContext, type ProtocolContext } from '../../../src/engine/testing.js';
import { type MockedGitClient } from '../../mock-types.js';
import { makeMockGitClient, makeMockInfra } from '../engine-test-utils.js';

describe('Git Security (Argument Escaping)', () => {
  let git: MockedGitClient;
  let protocols: ProtocolMap<ProtocolContext>;

  beforeEach(() => {
    git = makeMockGitClient();
    protocols = new ProtocolMap();
    protocols.set('mock', makeStubProtocolContext({
        name: 'Mock',
        identityKey: 'Mock-id',
        permissive: true, // Need permissive mode or explicitly defined trailer
        trailers: { 
            'Mock-id': { description: 'ID', multivalue: false, validation: 'none' },
            'Secret: ) | grep': { description: 'Malicious', multivalue: false, validation: 'none' }
        }
    }));
  });

  const getInfra = () => makeMockInfra({
      git,
      protocols
  });

  it('should pass author filter to GitClient.query raw (escaping is Client responsibility)', async () => {
    const maliciousAuthor = 'cole (admin) | rm -rf';
    const infra = getInfra();
    await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] }, { author: maliciousAuthor });
    
    expect(git.query).toHaveBeenCalledWith(expect.objectContaining({
        author: maliciousAuthor
    }));
  });

  it('should escape regex characters in scope filter (handled by Orchestrator)', async () => {
    const infra = getInfra();
    await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] }, { scope: 'ui) | grep (secret' });
    
    const query = git.query.mock.calls[0][0];
    const found = query.regexPatterns!.some((set: readonly string[]) => 
        set.some(p => p.includes('ui\\) \\| grep \\(secret'))
    );
    expect(found).toBe(true);
  });

  it('should escape regex characters in atom ID filter (handled by Orchestrator/Adapter)', async () => {
    const maliciousId = 'dead) | beef';
    const infra = getInfra();
    await findAtomById(infra, { id: maliciousId, protocol: 'mock' });
    
    const query = git.query.mock.calls[0][0];
    const found = query.regexPatterns!.some((set: readonly string[]) => 
        set.some(p => p.includes('dead\\) \\| beef'))
    );
    expect(found).toBe(true);
  });

  it('should escape regex characters in trailer key search (has filter)', async () => {
    const infra = getInfra();
    await findAtoms(infra, { type: 'global', raw: 'all', resolvedPaths: [] }, { has: 'Secret: ) | grep' });
    
    // The 'has' filter should result in an escaped regex pattern starting with ^
    const query = git.query.mock.calls[0][0];
    const found = query.regexPatterns!.some((set: readonly string[]) => 
        set.some(p => p.includes('^Secret: \\) \\| grep: '))
    );
    expect(found).toBe(true);
  });
});