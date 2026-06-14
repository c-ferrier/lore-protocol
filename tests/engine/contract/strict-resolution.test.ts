import { describe, expect, it, vi } from 'vitest';

import { resolveProtocolIdentity } from '../../../src/engine/core/logic/protocols.js';
import { type Atom, ProtocolMap } from '../../../src/engine/core/types/domain.js';
import { type ProtocolContext } from '../../../src/engine/core/types/protocol-definition.js';
import { type QueryTargetAST } from '../../../src/engine/core/types/query.js';
import { type RawCommit } from '../../../src/engine/interfaces/git-client.js';
import { type EngineInfra } from '../../../src/engine/services/engine-bootstrapper.js';
import { findAtomById, findAtomsStream } from '../../../src/engine/shell/orchestrators/discovery.js';
import { SYSTEM_PROTOCOL } from '../../../src/engine/util/constants.js';
import { ProtocolError } from '../../../src/engine/util/errors.js';
import { makeMockInfra, makeStubProtocolContext } from '../engine-test-utils.js';

describe('Phase 4.2: Strict Resolution & System Protocol', () => {
    
    it('should route system/hash directly to Git without index check', async () => {
        const hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
        const infra = makeMockInfra();
        
        // Mock identityIndex to show it wasn't called for system
        vi.spyOn(infra.identityIndex, 'get');
        
        // Mock git.filterAliveHashes to return the hash
        vi.mocked(infra.git.filterAliveHashes).mockResolvedValue([hash]);
        
        // Mock git.getLogStream (used by fetchCommitsByHashes)
        const FIELD_SEP = '\u001F';
        vi.mocked(infra.git.getLogStream).mockReturnValue((async function* () {
            yield `${hash}${FIELD_SEP}2026-01-01${FIELD_SEP}author${FIELD_SEP}subject${FIELD_SEP}body${FIELD_SEP}${FIELD_SEP}\n`;
        })() as AsyncIterable<string>);

        const result = await findAtomById(infra, { protocol: SYSTEM_PROTOCOL, id: hash });
        
        expect(infra.identityIndex.get).not.toHaveBeenCalled();
        expect(result).not.toBeNull();
        expect(result?.commitHash).toBe(hash);
    });

    it('should implement the Rental Agreement: root trailers owned by anchor if unregistered', async () => {
        const system = makeStubProtocolContext({ 
            name: 'system', 
            permissive: true, 
            namespace: '',
            identityKey: 'git-hash'
        });
        const lore = makeStubProtocolContext({ 
            name: 'lore', 
            permissive: false, 
            namespace: '',
            identityKey: 'Lore-id',
            trailers: { 'Lore-id': { description: 'ID', multivalue: false, validation: 'none' } }
        });

        const protocols = new ProtocolMap<ProtocolContext>();
        protocols.set('system', system);
        protocols.set('lore', lore);

        const infra = makeMockInfra({ protocols });
        
        const hash = 'h1';
        vi.mocked(infra.git.queryStream).mockReturnValue((async function* () {
            // Commit with both Lore and Ad-hoc trailers
            yield {
                hash,
                date: '2026-01-01T00:00:00Z',
                author: 'author',
                subject: 'subject',
                body: 'body',
                trailers: 'Lore-id: aabbccdd\nAdhoc: xyz',
                filesChanged: []
            };
        })() as AsyncIterable<RawCommit>);

        const [atom] = await findAtoms(infra, { type: 'global', raw: '.', resolvedPaths: ['.'] });

        // Lore should own its rented key
        expect(atom.protocols.get('lore')?.trailers['Lore-id']).toEqual(['aabbccdd']);
        // System should own the ad-hoc key (as the anchor)
        expect(atom.protocols.get('system')?.trailers['Adhoc']).toEqual(['xyz']);
        // Lore should NOT own the ad-hoc key (it is strict)
        expect(atom.protocols.get('lore')?.trailers['Adhoc']).toBeUndefined();
    });

    it('should throw ProtocolError if multiple line-ranges are provided', async () => {
        const context = {
            cwd: '/',
            protocolRoot: '/',
            isScoped: false
        };
        const { createQueryTarget } = await import('../../../src/engine/core/logic/query-targets.js');

        expect(() => createQueryTarget(['f1.ts:1-10', 'f2.ts:20-30'], context))
            .toThrow(ProtocolError);
    });

    it('should prioritize contextProtocol for unqualified IDs', async () => {
        const protocols = new ProtocolMap<ProtocolContext>();
        const lore = makeStubProtocolContext({ 
            name: 'lore', 
            identityKey: 'Lore-id',
            trailers: { 'Lore-id': { description: 'ID', multivalue: false, validation: 'pattern', pattern: '^[0-9a-f]{8}$' } }
        });
        protocols.set('lore', lore);
        protocols.set('system', makeStubProtocolContext({ 
            name: 'system',
            identityKey: 'git-hash',
            trailers: { 'git-hash': { description: 'Hash', multivalue: false, validation: 'pattern', pattern: '^[0-9a-f]{7,40}$' } }
        }));

        const id = 'aabbccdd'; // Looks like a hash AND a lore id
        
        // 1. Lore context
        const resLore = resolveProtocolIdentity(protocols, id, 'lore');
        expect(resLore.protocol).toBe('lore');

        // 2. System context
        const resSys = resolveProtocolIdentity(protocols, id, 'system');
        expect(resSys.protocol).toBe('system');
    });
});

async function findAtoms(infra: EngineInfra, target: QueryTargetAST): Promise<Atom[]> {
    const results: Atom[] = [];
    for await (const atom of findAtomsStream(infra, target)) {
        results.push(atom);
    }
    return results;
}
