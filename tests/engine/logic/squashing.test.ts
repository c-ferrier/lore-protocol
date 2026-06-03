import { describe, it, expect, beforeEach } from 'vitest';
import { squashAtoms } from '../../../src/engine/logic/squashing.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { 
    makeProtocol, 
    makeAtom,
    TEST_ID_KEY,
    ProtocolMap
} from '../engine-test-utils.js';

describe('Squashing Logic (Pure Functions)', () => {
  let registry: ProtocolRegistry;

  beforeEach(() => {
    registry = new ProtocolRegistry();
  });

  it('should throw error for empty atoms list', () => {
    expect(() => squashAtoms([], {}, registry)).toThrow(/Cannot merge zero atoms/);
  });

  it('should use subject override if provided', () => {
    const atom = makeAtom({ subject: 'original' });
    const input = squashAtoms([atom], { subject: 'overridden' }, registry);
    expect(input.subject).toBe('overridden');
  });

  it('should use newest atom subject if no override provided', () => {
    const oldAtom = makeAtom({ subject: 'old', date: new Date('2023-01-01') });
    const newAtom = makeAtom({ subject: 'new', date: new Date('2023-01-02') });
    
    const input = squashAtoms([oldAtom, newAtom], {}, registry);
    expect(input.subject).toBe('new');
  });

  it('should merge bodies into bulleted list of summaries', () => {
    const a1 = makeAtom({ body: 'Fix bug A\nMore notes', date: new Date('2023-01-01') });
    const a2 = makeAtom({ body: 'Add feature B', date: new Date('2023-01-02') });
    
    const input = squashAtoms([a1, a2], {}, registry);
    expect(input.body).toBe('- Fix bug A\n- Add feature B');
  });

  describe('Trailer Merging Strategies', () => {
    beforeEach(() => {
        registry.register(makeProtocol({
            name: 'mock',
            trailers: {
                'Confidence': { description: 'conf', squash: 'rank-max', values: { 'low': {}, 'medium': {}, 'high': {} } },
                'Severity': { description: 'sev', squash: 'rank-min', values: { 'P0': {}, 'P1': {}, 'P2': {} } },
                'Constraint': { description: 'cons', squash: 'union' },
                'Related': { description: 'rel', squash: 'union', ui: { kind: 'reference' } as any }
            }
        }));
    });

    it('should use union-dedup as default strategy', () => {
        const a1 = makeAtom({ trailers: { Constraint: ['A', 'B'] } });
        const a2 = makeAtom({ trailers: { Constraint: ['B', 'C'] } });
        
        const input = squashAtoms([a1, a2], {}, registry);
        expect(input.trailers.get('mock')!.Constraint).toEqual(['A', 'B', 'C']);
    });

    it('should respect rank-max strategy', () => {
        const a1 = makeAtom({ trailers: { Confidence: ['low'] } });
        const a2 = makeAtom({ trailers: { Confidence: ['high'] } });
        const a3 = makeAtom({ trailers: { Confidence: ['medium'] } });
        
        const input = squashAtoms([a1, a2, a3], {}, registry);
        expect(input.trailers.get('mock')!.Confidence).toEqual(['high']);
    });

    it('should respect rank-min strategy', () => {
        const a1 = makeAtom({ trailers: { Severity: ['P2'] } });
        const a2 = makeAtom({ trailers: { Severity: ['P1'] } });
        
        const input = squashAtoms([a1, a2], {}, registry);
        expect(input.trailers.get('mock')!.Severity).toEqual(['P1']);
    });

    it('should filter out internal references for kind=reference', () => {
        const a1 = makeAtom({ id: 'id1', trailers: { [TEST_ID_KEY]: ['id1'], Related: ['ext-1', 'id2'] } });
        const a2 = makeAtom({ id: 'id2', trailers: { [TEST_ID_KEY]: ['id2'], Related: ['ext-2', 'id1'] } });
        
        const input = squashAtoms([a1, a2], {}, registry);
        const mergedRelated = input.trailers.get('mock')!.Related;
        expect(mergedRelated).toEqual(['ext-1', 'ext-2']);
    });

    it('should work with a single atom', () => {
        const atom = makeAtom({ subject: 'single', trailers: { 'Mock-id': ['a1'], Constraint: ['rule'] } });
        const input = squashAtoms([atom], {}, registry);
        expect(input.subject).toBe('single');
        expect(input.trailers.get('mock')!.Constraint).toEqual(['rule']);
    });
  });

  it('should synthesize context for multiple protocols simultaneously', () => {
    registry.register(makeProtocol({ name: 'Alpha', namespace: 'alpha', identityKey: 'A-id' }));
    registry.register(makeProtocol({ name: 'Beta', namespace: 'beta', identityKey: 'B-id' }));

    const a1 = makeAtom({ 
        id: 'id1', 
        protocols: new ProtocolMap([
            ['alpha', { name: 'Alpha', trailers: { 'A-id': ['a1'], 'Status': ['active'] } } as any],
            ['beta', { name: 'Beta', trailers: { 'B-id': ['b1'], 'Priority': ['high'] } } as any]
        ])
    });

    const input = squashAtoms([a1], {}, registry);
    expect(input.trailers.get('alpha')!.Status).toEqual(['active']);
    expect(input.trailers.get('beta')!.Priority).toEqual(['high']);
  });
});
