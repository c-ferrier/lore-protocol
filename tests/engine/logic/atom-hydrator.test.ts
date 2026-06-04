import { extractReferenceIds, hydrateAtoms } from '../../../src/engine/core/logic/hydration.js';
import { TEST_PROTOCOL_DEFINITION, makeAtom, makeProtocol, makeProtocolRegistry, makeRawCommit } from '../../../src/engine/testing.js';

import { describe, it, expect } from 'vitest';
;
;

describe('AtomHydrator Logic (Pure Functions)', () => {
  const protocol = makeProtocol({
    name: 'test',
    version: '1.0',
    identityKey: 'Id',
    namespace: '',
    trailers: {
      'Id': { description: 'ID', multivalue: false, validation: 'none' as const },
      'Key': { description: 'Key', multivalue: false, validation: 'none' as const }
    }
  });

  const registry = makeProtocolRegistry([protocol]);

  describe('hydrateAtoms (Trailer Stripping)', () => {
    const hydrate = (body: string, trailers: string) => {
        const raw = makeRawCommit({
            subject: 'Subject',
            body,
            trailers,
            id: '12345678'
        });
        return hydrateAtoms([raw], registry)[0];
    };

    it('should strip trailers with varying whitespace', () => {
      const trailers = 'Id: 12345678\nKey: value';
      const body = 'Actual message.\n\n   Id: 12345678  \n Key: value \n\n';
      expect(hydrate(body, trailers).body).toBe('Actual message.');
    });

    it('should handle trailers indented with tabs', () => {
      const trailers = 'Id: 12345678\nKey: value';
      const body = 'Actual message.\n\n\tId: 12345678\n\tKey: value';
      expect(hydrate(body, trailers).body).toBe('Actual message.');
    });

    it('should NOT strip trailers if they appear in the middle of the body', () => {
      const trailers = 'Id: 12345678\nKey: value';
      const body = 'Message with Id: 12345678 inside it.\n\nMore text.';
      expect(hydrate(body, trailers).body).toBe(body.trim());
    });

    it('should handle multi-value trailers correctly', () => {
      const trailers = 'Id: 12345678\nKey: v1\nKey: v2';
      const body = 'Subject.\n\nId: 12345678\nKey: v1\nKey: v2';
      expect(hydrate(body, trailers).body).toBe('Subject.');
    });

    it('should return empty string if body is identical to trailers', () => {
      const trailers = 'Id: 12345678\nKey: val';
      const body = '  Id: 12345678\nKey: val  ';
      expect(hydrate(body, trailers).body).toBe('');
    });

    it('should handle CRLF line endings in trailers', () => {
      const trailers = 'Id: 12345678\r\nKey: val';
      const body = 'Message.\n\nId: 12345678\nKey: val';
      expect(hydrate(body, trailers).body).toBe('Message.');
    });
  });

  describe('extractReferenceIds', () => {
      it('should extract unique identities from atom protocol state', () => {
          const mockProtocol = makeProtocol({
              trailers: {
                  ...TEST_PROTOCOL_DEFINITION.trailers,
                  'Related': { description: 'R', validation: 'reference' } as any
              }
          }); 
          const localRegistry = makeProtocolRegistry([mockProtocol]);

          const atom = makeAtom({
              protocols: new Map([['mock', { 
                  trailers: {
                      'Mock-id': ['atom1'],
                      'Related': ['atom2', 'atom3']
                  },
                  unauthorized: {}
              }]])
          });
          const ids = extractReferenceIds([atom], localRegistry);
          expect(ids).toHaveLength(2);
          expect(ids.map(i => i.id)).toContain('atom2');
          expect(ids.map(i => i.id)).toContain('atom3');
      });
  });
});