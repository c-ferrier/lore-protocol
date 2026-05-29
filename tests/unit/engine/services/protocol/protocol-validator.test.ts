import { describe, it, expect, vi } from 'vitest';
import { ProtocolValidator } from '../../../../../src/engine/services/protocol/protocol-validator.js';
import type { IProtocol } from '../../../../../src/engine/interfaces/protocol.js';

describe('ProtocolValidator', () => {
  const createMockProtocol = (overrides: Partial<IProtocol> = {}) => ({
    name: 'Mock',
    strict: false,
    permissive: true,
    identityKey: 'Mock-id',
    getAuthorizedKeys: vi.fn(() => ['Mock-id', 'Confidence']),
    getDefinition: vi.fn((key: string) => {
        if (key === 'Mock-id') return { key: 'Mock-id', description: '', multivalue: false, required: true };
        if (key === 'Confidence') return { key: 'Confidence', description: '', multivalue: false, validation: 'values', values: { high: {}, low: {} }, required: true };
        return null;
    }),
    ...overrides
  } as unknown as IProtocol);

  it('should report missing required trailers as errors in strict mode', () => {
    const protocol = createMockProtocol({ strict: true });
    const validator = new ProtocolValidator(protocol);
    
    const state = {
        trailers: {},
        unauthorized: {}
    };

    const issues = validator.validateState(state);
    const idIssue = issues.find(i => i.field === 'Mock-id');
    const confIssue = issues.find(i => i.field === 'Confidence');

    expect(idIssue?.severity).toBe('error');
    expect(confIssue?.severity).toBe('error');
  });

  it('should report missing optional required trailers as warnings in non-strict mode', () => {
    const protocol = createMockProtocol({ strict: false });
    const validator = new ProtocolValidator(protocol);
    
    const state = {
        trailers: {},
        unauthorized: {}
    };

    const issues = validator.validateState(state);
    const idIssue = issues.find(i => i.field === 'Mock-id');
    const confIssue = issues.find(i => i.field === 'Confidence');

    // Identity is ALWAYS an error if missing
    expect(idIssue?.severity).toBe('error');
    // Other required trailers are warnings in non-strict
    expect(confIssue?.severity).toBe('warning');
  });

  it('should validate enum values', () => {
    const protocol = createMockProtocol();
    const validator = new ProtocolValidator(protocol);

    const validResult = validator.validateTrailer('Confidence', 'high');
    expect(validResult.valid).toBe(true);

    const invalidResult = validator.validateTrailer('Confidence', 'junk');
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.rule).toBe('invalid-enum');
  });

  it('should report unauthorized trailers in non-permissive mode', () => {
    const protocol = createMockProtocol({ permissive: false });
    const validator = new ProtocolValidator(protocol);

    const state = {
        trailers: { 'Mock-id': ['abc'] },
        unauthorized: { 'Typo': ['val'] }
    };

    const issues = validator.validateState(state);
    const typoIssue = issues.find(i => i.field === 'Typo');

    expect(typoIssue).toBeDefined();
    expect(typoIssue?.severity).toBe('error');
    expect(typoIssue?.rule).toBe('unauthorized-trailer');
  });

  it('should validate pattern formats', () => {
    const protocol = createMockProtocol({
        getDefinition: vi.fn((key: string) => {
            if (key === 'Id') return { key: 'Id', description: '', multivalue: false, validation: 'pattern', pattern: '^[0-9]+$' };
            return null;
        })
    });
    const validator = new ProtocolValidator(protocol);

    const validResult = validator.validateTrailer('Id', '12345');
    expect(validResult.valid).toBe(true);

    const invalidResult = validator.validateTrailer('Id', 'abcde');
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.rule).toBe('invalid-format');
  });

  it('should validate local reference formats without a registry', () => {
    const protocol = createMockProtocol({
        name: 'Mock',
        isValidIdentity: vi.fn((id: string) => /^[0-9a-f]{8}$/.test(id)),
        getDefinition: vi.fn((key: string) => {
            if (key === 'Ref') return { key: 'Ref', description: '', multivalue: false, validation: 'reference' };
            return null;
        })
    });
    const validator = new ProtocolValidator(protocol);

    // Local ref (no prefix)
    expect(validator.validateTrailer('Ref', 'a1b2c3d4').valid).toBe(true);
    expect(validator.validateTrailer('Ref', 'junk').valid).toBe(false);

    // Explicit local ref (with prefix matching name)
    expect(validator.validateTrailer('Ref', 'mock/a1b2c3d4').valid).toBe(true);
  });

  it('should enforce boundary rules (crossProtocol: false)', () => {
    const protocol = createMockProtocol({
        name: 'Strict',
        getDefinition: vi.fn((key: string) => {
            if (key === 'Ref') return { key: 'Ref', description: '', multivalue: false, validation: 'reference', crossProtocol: false };
            return null;
        })
    });
    const validator = new ProtocolValidator(protocol);

    // Cross-protocol ref to 'other' -> prohibited
    const result = validator.validateTrailer('Ref', 'other/123');
    expect(result.valid).toBe(false);
    expect(result.rule).toBe('cross-protocol-prohibited');
  });
});
