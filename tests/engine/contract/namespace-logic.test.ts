import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { makeProtocol, normalizeTrailers } from '../../../src/engine/testing.js';
import { getSearchPatterns } from '../../../src/engine/shell/git/protocol-query-adapter.js';
import { ownsKey } from '../../../src/engine/core/logic/ownership.js';
import { TriggerParser } from '../../../src/engine/util/trigger-parser.js';

import { describe, it, expect, beforeEach } from 'vitest';

describe('Hierarchical Namespacing Logic', () => {
  let registry: ProtocolRegistry;
  let rootProtocol: ProtocolContext;
  let projectProtocol: ProtocolContext;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    
    // 1. Root Protocol (Strict)
    rootProtocol = makeProtocol({
      name: 'Root',
      version: '1.0',
      identityKey: 'Lore-id',
      namespace: '',
      trailers: {
        'Lore-id': { description: 'ID' },
        'Constraint': { description: 'Constraint' }
      }
    }, { strict: true, permissive: false } as any);

    // 2. Namespaced Protocol (Strict)
    projectProtocol = makeProtocol({
      name: 'Project',
      version: '1.0',
      identityKey: 'Project-id',
      namespace: 'Project',
      trailers: {
        'Project-id': { description: 'ID' },
        'Team': { description: 'Team' }
      }
    }, { strict: true, permissive: false } as any);

    registry.register(rootProtocol);
    registry.register(projectProtocol);
  });

  describe('Ownership', () => {
    it('namespaced protocol should own its namespace key only', () => {
      expect(ownsKey('Project', projectProtocol)).toBe(true);
      expect(ownsKey('project', projectProtocol)).toBe(true);
      
      // STRICT ISOLATION: Namespaced protocols don't own root trailers (even their ID)
      expect(ownsKey('Project-id', projectProtocol)).toBe(false);
      expect(ownsKey('Team', projectProtocol)).toBe(false);
    });

    it('root protocol should own its schema keys', () => {
      expect(ownsKey('Lore-id', rootProtocol)).toBe(true);
      expect(ownsKey('Constraint', rootProtocol)).toBe(true);
      expect(ownsKey('Project', rootProtocol)).toBe(false);
    });
  });

  describe('Parsing (History)', () => {
    it('should unpack namespaced trailers correctly', () => {
      const raw = 'Project: Project-id: abcd1234\nProject: Team: Backend';
      const state = normalizeTrailers(TriggerParser.parseTrailers(raw), projectProtocol);

      expect(state.trailers['Project-id']).toEqual(['abcd1234']);
      expect(state.trailers.Team).toEqual(['Backend']);
      expect(Object.keys(state.unauthorized)).toHaveLength(0);
    });

    it('should flag unrecognized trailers in namespace as unauthorized when strict', () => {
      const raw = 'Project: Tream: typo\nProject: Team: Backend';
      const state = normalizeTrailers(TriggerParser.parseTrailers(raw), projectProtocol);

      expect(state.trailers.Team).toEqual(['Backend']);
      expect(state.unauthorized.Tream).toEqual(['typo']);
    });

    it('should allow unrecognized trailers in namespace when permissive', () => {
      const permissiveProject = makeProtocol({
          name: 'Project',
          namespace: 'Project',
          permissive: true,
          trailers: { 'Team': { description: 'T' } }
      }, { strict: false, permissive: true } as any);
      
      const raw = 'Project: Custom: value';
      const state = normalizeTrailers(TriggerParser.parseTrailers(raw), permissiveProject);

      expect(state.trailers.Custom).toEqual(['value']);
      expect(Object.keys(state.unauthorized)).toHaveLength(0);
    });

    it('root protocol should ignore namespaced trailers', () => {
      const raw = 'Project: Team: Backend\nLore-id: deadbeef';
      const state = normalizeTrailers(TriggerParser.parseTrailers(raw), rootProtocol);

      expect(state.trailers['Lore-id']).toEqual(['deadbeef']);
      expect(state.trailers['Project']).toBeUndefined();
    });

    it('root protocol should flag orphans as unauthorized when strict', () => {
      const raw = 'Unknown: value';
      const state = normalizeTrailers(TriggerParser.parseTrailers(raw), rootProtocol);

      expect(state.trailers.Unknown).toBeUndefined();
      expect(state.unauthorized.Unknown).toEqual(['value']);
    });

    it('root protocol should claim orphans as trailers when permissive', () => {
        const permissiveRoot = makeProtocol({
            ...rootProtocol['definition'],
            permissive: true
        }, { strict: false, permissive: true } as any);
  
        const raw = 'Unknown: value';
        const state = normalizeTrailers(TriggerParser.parseTrailers(raw), permissiveRoot);
  
        expect(state.trailers.Unknown).toEqual(['value']);
        expect(Object.keys(state.unauthorized)).toHaveLength(0);
    });
  });

  describe('Discovery', () => {
    it('should aggregate discovery patterns correctly', () => {
      const patterns = registry.getDiscoveryPatterns();
      // Root discovery: identityKey:
      expect(patterns).toContain('^Lore-id: ');
      // NS discovery: namespace:
      expect(patterns).toContain('^Project:');
    });
  });

  describe('Search Patterns', () => {
      it('should generate namespaced patterns for namespaced search', () => {
          const patterns = getSearchPatterns([{ protocol: null, key: 'Team', op: 'eq' as const, value: 'Backend' }], projectProtocol);
          expect(patterns).toEqual([['^Project: Team: Backend']]);
      });

      it('should generate flat patterns for root search', () => {
          const patterns = getSearchPatterns([{ protocol: null, key: 'Lore-id', op: 'eq' as const, value: 'l1' }], rootProtocol);
          expect(patterns).toEqual([['^Lore-id: l1']]);
      });
  });
});
