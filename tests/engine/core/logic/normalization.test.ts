import { describe, it, expect } from 'vitest';
import { makeProtocol } from '../../../../src/engine/testing.js';
import { normalizeTrailers } from '../../../../src/engine/core/logic/normalization.js';

describe('Normalization Logic (Strict Segmented Waterfall)', () => {

  describe('Root Context (Global)', () => {
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

    it('should parse and normalize authorized trailers', () => {
      const raw = {
        'Lore-id': ['a1b2c3d4'],
        'Constraint': ['c1']
      };
      const state = normalizeTrailers(raw, rootProtocol);
      expect(state.trailers['Lore-id']).toEqual(['a1b2c3d4']);
      expect(state.trailers.Constraint).toEqual(['c1']);
    });

    it('should be case-insensitive during normalization', () => {
        const raw = { 'lore-id': ['a1b2c3d4'] };
        const state = normalizeTrailers(raw, rootProtocol);
        expect(state.trailers['Lore-id']).toEqual(['a1b2c3d4']);
    });

    it('should flag unauthorized trailers in strict mode', () => {
        const strictRoot = { ...rootProtocol, permissive: false };
        const raw = { 'Unknown': ['value'] };
        const state = normalizeTrailers(raw, strictRoot);
        expect(state.trailers.Unknown).toBeUndefined();
        expect(state.unauthorized.Unknown).toEqual(['value']);
    });

    it('should capture orphans in permissive mode', () => {
        const permissiveRoot = { ...rootProtocol, permissive: true };
        const raw = { 'Unknown': ['value'] };
        const state = normalizeTrailers(raw, permissiveRoot);
        expect(state.trailers.Unknown).toEqual(['value']);
    });

    it('should ignore keys claimed by other protocols', () => {
        const raw = { 'Project': ['inner: value'] };
        const claimed = new Set(['project']);
        const state = normalizeTrailers(raw, rootProtocol, claimed);
        expect(state.trailers.Project).toBeUndefined();
        expect(state.unauthorized.Project).toBeUndefined();
    });

    it('should normalize mixed-case trailers to canonical keys', () => {
        const protocol = makeProtocol({ 
            name: 'Root', 
            trailers: { Confidence: { description: 'C' } }
        });
        
        const raw = {
          'confidence': ['high'],
          'CONFIDENCE': ['low']
        };
    
        const state = normalizeTrailers(raw, protocol);
        expect(state.trailers.Confidence).toEqual(['high', 'low']);
    });
  });

  describe('Namespaced Context (Bucket)', () => {
    const projectProtocol = makeProtocol({
      name: 'Project',
      version: '1.0',
      identityKey: 'Id',
      namespace: 'Project',
      trailers: {
        'Id': { description: 'ID' },
        'Team': { description: 'Team' }
      }
    });

    it('should unpack namespaced bucket trailers', () => {
      const raw = {
        'Project': ['Id: a1b2c3d4', 'Team: Backend']
      };
      const state = normalizeTrailers(raw, projectProtocol);
      expect(state.trailers.Id).toEqual(['a1b2c3d4']);
      expect(state.trailers.Team).toEqual(['Backend']);
    });

    it('should handle namespaced trailers when provided as prefixed global keys', () => {
        const raw = {
          'Project: Id': ['12345678'],
          'Project: Team': ['backend']
        };
    
        const state = normalizeTrailers(raw, projectProtocol);
        expect(state.trailers.Id).toEqual(['12345678']);
        expect(state.trailers.Team).toEqual(['backend']);
    });

    it('should flag unrecognized nested trailers as unauthorized when strict', () => {
      const strictProject = { ...projectProtocol, permissive: false };
      const raw = { 'Project': ['Tream: typo'] };
      const state = normalizeTrailers(raw, strictProject);
      expect(state.unauthorized.Tream).toEqual(['typo']);
    });

    it('should allow unrecognized nested trailers when permissive', () => {
      const permissiveProject = { ...projectProtocol, permissive: true };
      const raw = { 'Project': ['Custom: value'] };
      const state = normalizeTrailers(raw, permissiveProject);
      expect(state.trailers.Custom).toEqual(['value']);
    });

    it('should ignore root-level trailers (Strict Isolation)', () => {
        const raw = { 'Id': ['12345'] };
        const state = normalizeTrailers(raw, projectProtocol);
        expect(state.trailers.Id).toBeUndefined();
    });

    it('should handle invalid nested format in bucket', () => {
        const raw = { 'Project': ['Not-A-Trailer'] };
        const state = normalizeTrailers(raw, projectProtocol);
        expect(state.unauthorized['invalid-format']).toEqual(['Not-A-Trailer']);
    });

    it('should report unauthorized trailers in a namespaced protocol', () => {
        const nsProtocol = makeProtocol({ 
              name: 'Project', 
              namespace: 'Project', 
              identityKey: 'Id',
              trailers: { 'Id': { description: 'ID' }, 'Team': { description: 'T' } }
        }, { strict: true, permissive: false });

        const raw = { 'Project': ['Id: a1b2c3d4', 'Tream: typo'] };
        const state = normalizeTrailers(raw, nsProtocol);

        expect(state.unauthorized.Tream).toEqual(['typo']);
    });
  });

  describe('Normalization Priority Matrix', () => {
    it('Explicit Ownership should win over Reserved Check', () => {
        const protocol = makeProtocol({
            name: 'Mock',
            trailers: { 'Owned': { description: 'D' } }
        });
        const raw = { 'Owned': ['value'] };
        const state = normalizeTrailers(raw, protocol, new Set(['owned'])); 
        // We explicitly own it, so we take it even if it's "claimed" (by us or others)
        expect(state.trailers.Owned).toEqual(['value']);
    });

    it('Reserved Check should win over Permissive Ingestion', () => {
        const protocol = makeProtocol({ name: 'Root', namespace: '', permissive: true });
        const raw = { 'Reserved': ['value'] };
        const state = normalizeTrailers(raw, protocol, new Set(['reserved']));
        // It's reserved by someone else, so even though we are permissive, we ignore it.
        expect(state.trailers.Reserved).toBeUndefined();
    });
  });
});
