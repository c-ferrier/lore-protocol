import { describe, it, expect } from 'vitest';
import { makeProtocol, MOCK_CORE_TRAILERS } from '../../../../src/engine/testing.js';
import { ownsKey, authorizeKey, isBucketOwner, getQualifiedKey } from '../../../../src/engine/core/logic/ownership.js';

describe('Ownership Logic (Pure Functions)', () => {
  const rootProtocol = makeProtocol({
    name: 'Root',
    version: '1.0',
    identityKey: 'Lore-id',
    namespace: '',
    trailers: {
      'Lore-id': { description: 'ID' },
      'Constraint': { description: 'Constraint' }
    }
  });

  const projectProtocol = makeProtocol({
    name: 'Project',
    version: '1.0',
    identityKey: 'Project-id',
    namespace: 'Project',
    trailers: {
      'Project-id': { description: 'ID' },
      'Team': { description: 'Team' }
    }
  });

  describe('ownsKey', () => {
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

    it('should be case-insensitive', () => {
        expect(ownsKey('LORE-ID', rootProtocol)).toBe(true);
        expect(ownsKey('project', projectProtocol)).toBe(true);
    });
  });

  describe('authorizeKey', () => {
    it('should return canonical case for schema keys', () => {
        expect(authorizeKey('lore-id', rootProtocol)).toBe('Lore-id');
        expect(authorizeKey('constraint', rootProtocol)).toBe('Constraint');
    });

    it('should prioritize core casing over ad-hoc casing', () => {
        const protocol = makeProtocol({ 
            name: 'PriorityCaseTest',
            trailers: { ...rootProtocol.def.trailers, ...MOCK_CORE_TRAILERS }
        });
        expect(authorizeKey('confidence', protocol)).toBe('Confidence');
    });

    it('should return namespace for bucket keys', () => {
        expect(authorizeKey('project', projectProtocol)).toBe('Project');
    });

    it('should return null for unauthorized keys in strict mode', () => {
        const strictRoot = { ...rootProtocol, permissive: false };
        expect(authorizeKey('Unknown', strictRoot)).toBeNull();
    });

    it('should return the original key in permissive mode', () => {
        const permissiveRoot = { ...rootProtocol, permissive: true };
        expect(authorizeKey('Adhoc', permissiveRoot)).toBe('Adhoc');
    });
  });

  describe('isBucketOwner', () => {
      it('root protocol should always be a bucket owner (owns global space)', () => {
          expect(isBucketOwner('any', rootProtocol)).toBe(true);
      });

      it('namespaced protocol should only own its namespace bucket', () => {
          expect(isBucketOwner('Project', projectProtocol)).toBe(true);
          expect(isBucketOwner('Other', projectProtocol)).toBe(false);
      });
  });

  describe('getQualifiedKey', () => {
      it('should return flat key for root protocol', () => {
          expect(getQualifiedKey('Lore-id', rootProtocol)).toBe('Lore-id');
      });

      it('should return prefixed key for namespaced protocol', () => {
          expect(getQualifiedKey('Team', projectProtocol)).toBe('Project: Team');
      });

      it('should return original key if not authorized', () => {
          expect(getQualifiedKey('Unknown', projectProtocol)).toBe('Unknown');
      });
  });
});
