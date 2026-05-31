import { describe, it, expect, beforeEach } from 'vitest';
import { AtomHydrator } from '../../../src/engine/services/atom-hydrator.ts';
import { makeProtocol, makeAtomHydrator, makeProtocolRegistry, makeAtom } from '../engine-test-utils.js';

describe('AtomHydrator Logic', () => {
  let hydrator: AtomHydrator;
  const protocol = makeProtocol({
    name: 'Test',
    version: '1.0',
    identityKey: 'Id',
    namespace: '',
    trailers: {
      'Id': { description: 'ID', multivalue: false, validation: 'none' as const },
      'Key': { description: 'Key', multivalue: false, validation: 'none' as const }
    }
  });

  beforeEach(() => {
    const registry = makeProtocolRegistry([protocol]);
    hydrator = makeAtomHydrator({
        registry
    });
  });

  describe('stripTrailersFromBody', () => {
    const strip = (body: string, trailers: string) => (hydrator as any).stripTrailersFromBody(body, trailers);

    it('should strip trailers with varying whitespace', () => {
      const trailers = 'Id: 12345678\nKey: value';
      const body = 'Actual message.\n\n   Id: 12345678  \n Key: value \n\n';
      expect(strip(body, trailers)).toBe('Actual message.');
    });

    it('should handle trailers indented with tabs', () => {
      const trailers = 'Id: 12345678\nKey: value';
      const body = 'Actual message.\n\n\tId: 12345678\n\tKey: value';
      expect(strip(body, trailers)).toBe('Actual message.');
    });

    it('should NOT strip trailers if they appear in the middle of the body', () => {
      const trailers = 'Id: 12345678\nKey: value';
      const body = 'Message with Id: 12345678 inside it.\n\nMore text.';
      expect(strip(body, trailers)).toBe(body.trim());
    });

    it('should handle multi-value trailers correctly', () => {
      const trailers = 'Id: 123\nKey: v1\nKey: v2';
      const body = 'Subject.\n\nId: 123\nKey: v1\nKey: v2';
      expect(strip(body, trailers)).toBe('Subject.');
    });

    it('should return empty string if body is identical to trailers', () => {
      const trailers = 'Id: 12345678\nKey: val';
      const body = '  Id: 12345678\nKey: val  ';
      expect(strip(body, trailers)).toBe('');
    });

    it('should handle CRLF line endings in trailers', () => {
      const trailers = 'Id: 123\r\nKey: val';
      const body = 'Message.\n\nId: 123\nKey: val';
      expect(strip(body, trailers)).toBe('Message.');
    });
  });

  describe('extractReferenceIds', () => {
      it('should extract unique identities from atom protocol state', () => {
          // Use the 'mock' protocol which has 'Related' defined as a reference key in TEST_PROTOCOL_DEFINITION
          const mockProtocol = makeProtocol(); 
          const registry = makeProtocolRegistry([mockProtocol]);
          const testHydrator = makeAtomHydrator({ registry });

          const atom = makeAtom({
              protocols: new Map([['mock', { 
                  trailers: {
                      'Mock-id': ['atom1'],
                      'Related': ['atom2', 'atom3']
                  },
                  unauthorized: {}
              }]])
          });
          const ids = testHydrator.extractReferenceIds([atom]);
          expect(ids).toHaveLength(2);
          expect(ids.map(i => i.id)).toContain('atom2');
          expect(ids.map(i => i.id)).toContain('atom3');
      });
  });
});
