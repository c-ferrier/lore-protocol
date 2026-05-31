import { describe, it, expect, beforeEach } from 'vitest';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { 
  TEST_PROTOCOL_DEFINITION, 
  TEST_ENGINE_CONFIG, 
  makeProtocolConfig,
  makeProtocol
} from '../engine-test-utils.js';

describe('Hierarchical Namespacing Logic', () => {
  let registry: ProtocolRegistry;
  let rootProtocol: Protocol;
  let projectProtocol: Protocol;

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
      expect(projectProtocol.owns('Project')).toBe(true);
      expect(projectProtocol.owns('project')).toBe(true);
      expect(projectProtocol.owns('Project-id')).toBe(false);
      expect(projectProtocol.owns('Team')).toBe(false);
    });

    it('root protocol should own its schema keys', () => {
      expect(rootProtocol.owns('Lore-id')).toBe(true);
      expect(rootProtocol.owns('Constraint')).toBe(true);
      expect(rootProtocol.owns('Project')).toBe(false);
    });
  });

  describe('Parsing (History)', () => {
    it('should unpack namespaced trailers correctly', () => {
      const raw = 'Project: Project-id: abcd1234\nProject: Team: Backend';
      const state = projectProtocol.parse(raw);

      expect(state.trailers['Project-id']).toEqual(['abcd1234']);
      expect(state.trailers.Team).toEqual(['Backend']);
      expect(Object.keys(state.unauthorized)).toHaveLength(0);
    });

    it('should flag unrecognized trailers in namespace as unauthorized when strict', () => {
      const raw = 'Project: Tream: typo\nProject: Team: Backend';
      const state = projectProtocol.parse(raw);

      expect(state.trailers.Team).toEqual(['Backend']);
      expect(state.unauthorized.Tream).toEqual(['typo']);
    });

    it('should allow unrecognized trailers in namespace when permissive', () => {
      const permissiveProject = makeProtocol({
          name: 'Project',
          namespace: 'Project',
          trailers: { 'Team': { description: 'T' } }
      }, { strict: false, permissive: true } as any);
      
      const raw = 'Project: Custom: value';
      const state = permissiveProject.parse(raw);

      expect(state.trailers.Custom).toEqual(['value']);
      expect(Object.keys(state.unauthorized)).toHaveLength(0);
    });

    it('root protocol should ignore namespaced trailers', () => {
      const raw = 'Project: Team: Backend\nLore-id: deadbeef';
      const state = rootProtocol.parse(raw);

      expect(state.trailers['Lore-id']).toEqual(['deadbeef']);
      expect(state.trailers['Project']).toBeUndefined();
    });

    it('root protocol should flag orphans as unauthorized when strict', () => {
      const raw = 'Unknown: value';
      const state = rootProtocol.parse(raw);

      expect(state.trailers.Unknown).toBeUndefined();
      expect(state.unauthorized.Unknown).toEqual(['value']);
    });

    it('root protocol should claim orphans as trailers when permissive', () => {
        const permissiveRoot = makeProtocol(
          rootProtocol['definition'],
          makeProtocolConfig({ strict: false, permissive: true })
        );
  
        const raw = 'Unknown: value';
        const state = permissiveRoot.parse(raw);
  
        expect(state.trailers.Unknown).toEqual(['value']);
        expect(Object.keys(state.unauthorized)).toHaveLength(0);
    });
  });

  describe('Discovery', () => {
    it('should aggregate discovery patterns correctly', () => {
      const patterns = registry.getDiscoveryPatterns();
      // Root discovery: identityKey: .+
      expect(patterns).toContain('^Lore-id: .+');
      // NS discovery: namespace:
      expect(patterns).toContain('^Project:');
    });
  });

  describe('Search Patterns', () => {
      it('should generate namespaced patterns for namespaced search', () => {
          const patterns = projectProtocol.getSearchPatterns({ Team: 'Backend' });
          expect(patterns).toEqual([['^Project: Team: Backend']]);
      });

      it('should generate flat patterns for root search', () => {
          const patterns = rootProtocol.getSearchPatterns({ 'Lore-id': 'l1' });
          expect(patterns).toEqual([['^Lore-id: l1']]);
      });
  });
});
