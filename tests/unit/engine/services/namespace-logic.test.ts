import { describe, it, expect, beforeEach } from 'vitest';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { 
  MOCK_PROTOCOL_DEFINITION, 
  MOCK_CONFIG, 
  makeProtocolConfig 
} from '../test-utils.js';

describe('Hierarchical Namespacing Logic', () => {
  let registry: ProtocolRegistry;
  let rootProtocol: Protocol;
  let projectProtocol: Protocol;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    
    // 1. Root Protocol (Strict)
    rootProtocol = new Protocol(
      { 
        ...MOCK_PROTOCOL_DEFINITION, 
        namespace: '', 
        identityKey: 'Lore-id',
        trailers: {
            ...MOCK_PROTOCOL_DEFINITION.trailers,
            'Lore-id': MOCK_PROTOCOL_DEFINITION.trailers[MOCK_PROTOCOL_DEFINITION.identityKey]
        }
      },
      makeProtocolConfig({ ...MOCK_CONFIG, trailers: { ...MOCK_CONFIG.trailers, permissive: false } })
    );

    // 2. Namespaced Protocol (Strict)
    projectProtocol = new Protocol(
      { 
        ...MOCK_PROTOCOL_DEFINITION, 
        name: 'Project', 
        namespace: 'Project', 
        identityKey: 'Id',
        trailers: {
            'Id': { description: 'ID', multivalue: false, validation: 'pattern' as const, pattern: '^[0-9a-f]{8}$' },
            'Team': { description: 'Team', multivalue: false }
        }
      },
      makeProtocolConfig({ ...MOCK_CONFIG, trailers: { ...MOCK_CONFIG.trailers, permissive: false } })
    );

    registry.register(rootProtocol);
    registry.register(projectProtocol);
  });

  describe('Ownership', () => {
    it('namespaced protocol should own its namespace key only', () => {
      expect(projectProtocol.owns('Project')).toBe(true);
      expect(projectProtocol.owns('project')).toBe(true);
      expect(projectProtocol.owns('Id')).toBe(false);
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
      const raw = 'Project: Id: abcd1234\nProject: Team: Backend';
      const state = projectProtocol.parse(raw);

      expect(state.trailers.Id).toEqual(['abcd1234']);
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
      const permissiveProject = new Protocol(
        projectProtocol['definition'],
        makeProtocolConfig({ ...MOCK_CONFIG, trailers: { ...MOCK_CONFIG.trailers, permissive: true } })
      );
      
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
      const permissiveRoot = new Protocol(
        rootProtocol['definition'],
        makeProtocolConfig({ ...MOCK_CONFIG, trailers: { ...MOCK_CONFIG.trailers, permissive: true } })
      );

      const raw = 'Unknown: value';
      const state = permissiveRoot.parse(raw);

      expect(state.trailers.Unknown).toEqual(['value']);
      expect(Object.keys(state.unauthorized)).toHaveLength(0);
    });
  });

  describe('Grep & Search', () => {
      it('should generate nested colon grep for namespaced search', () => {
          const grep = projectProtocol.getSearchGrep({ Team: 'Backend' });
          expect(grep).toContain('--grep=^Project: Team: Backend');
      });

      it('should generate flat grep for root search', () => {
          const grep = rootProtocol.getSearchGrep({ 'Lore-id': 'l1' });
          expect(grep).toContain('--grep=^Lore-id: l1');
      });
  });
});
