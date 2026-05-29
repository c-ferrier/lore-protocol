import { describe, it, expect, vi } from 'vitest';
import { ProtocolInterpreter } from '../../../../../src/engine/services/protocol/protocol-interpreter.js';
import { TrailerParser } from '../../../../../src/engine/services/trailer-parser.js';
import type { IProtocol } from '../../../../../src/engine/interfaces/protocol.js';

describe('ProtocolInterpreter', () => {
  const parser = new TrailerParser();
  
  const createMockProtocol = (overrides: Partial<IProtocol> = {}) => ({
    name: 'Mock',
    namespace: '',
    identityKey: 'Mock-id',
    permissive: true,
    owns: vi.fn((key: string) => key === 'Mock-id'),
    authorize: vi.fn((key: string) => (key === 'Mock-id' ? 'Mock-id' : (overrides.permissive !== false ? key : null))),
    getDefinition: vi.fn(),
    ...overrides
  } as unknown as IProtocol);

  it('should normalize raw trailers into authorized and unauthorized buckets', () => {
    const protocol = createMockProtocol({ permissive: false });
    const interpreter = new ProtocolInterpreter(protocol, parser);
    
    const raw = {
      'Mock-id': ['a1b2c3d4'],
      'Unknown': ['junk']
    };

    const state = interpreter.normalize(raw);
    expect(state.trailers['Mock-id']).toEqual(['a1b2c3d4']);
    expect(state.unauthorized['Unknown']).toEqual(['junk']);
  });

  it('should ingest unknown trailers in permissive mode', () => {
    const protocol = createMockProtocol({ permissive: true });
    const interpreter = new ProtocolInterpreter(protocol, parser);
    
    const raw = {
      'Unknown': ['value']
    };

    const state = interpreter.normalize(raw);
    expect(state.trailers['Unknown']).toEqual(['value']);
    expect(state.unauthorized).toEqual({});
  });

  it('should handle namespaced trailers when configured', () => {
    const protocol = createMockProtocol({ 
        name: 'Project',
        namespace: 'Project',
        identityKey: 'Id',
        owns: vi.fn((key: string) => key === 'Project'),
        authorize: vi.fn((key: string) => key === 'Id' ? 'Id' : null),
        permissive: false
    });
    const interpreter = new ProtocolInterpreter(protocol, parser);

    const raw = {
        'Project': ['Id: 12345678', 'Team: backend']
    };

    const state = interpreter.normalize(raw);
    expect(state.trailers.Id).toEqual(['12345678']);
    expect(state.unauthorized.Team).toEqual(['backend']);
  });

  it('should extract identity from protocol state', () => {
    const protocol = createMockProtocol({ identityKey: 'Lore-id' });
    const interpreter = new ProtocolInterpreter(protocol, parser);

    const state = {
        trailers: { 'Lore-id': ['atom-123'] },
        unauthorized: {}
    };

    expect(interpreter.getIdentity(state)).toBe('atom-123');
    expect(interpreter.getIdentity(null)).toBeNull();
  });

  it('should handle namespaced trailers with invalid formats by putting them in unauthorized bucket', () => {
    const protocol = createMockProtocol({ 
        name: 'Project',
        namespace: 'Project',
        identityKey: 'Id',
        owns: vi.fn((key: string) => key === 'Project'),
        permissive: false
    });
    const interpreter = new ProtocolInterpreter(protocol, parser);

    const raw = {
        'Project': ['this is not a key-value pair']
    };

    const state = interpreter.normalize(raw);
    expect(state.unauthorized['invalid-format']).toEqual(['this is not a key-value pair']);
  });

  it('should respect claimed keys in permissive mode', () => {
    const protocol = createMockProtocol({ permissive: true });
    const interpreter = new ProtocolInterpreter(protocol, parser);
    
    const raw = {
      'Owned-By-Other': ['secret']
    };

    // Simulation: Owned-By-Other is explicitly claimed by another protocol
    const state = interpreter.normalize(raw, new Set(['Owned-By-Other']));
    expect(state.trailers['Owned-By-Other']).toBeUndefined();
  });

  it('should normalize mixed-case trailers to canonical keys', () => {
    const protocol = createMockProtocol({ 
        authorize: vi.fn((key: string) => key.toLowerCase() === 'confidence' ? 'Confidence' : null),
        owns: vi.fn((key: string) => key.toLowerCase() === 'confidence')
    });
    const interpreter = new ProtocolInterpreter(protocol, parser);

    const raw = {
        'CONFIDENCE': ['high'],
        'confidence': ['low']
    };

    const state = interpreter.normalize(raw);
    expect(state.trailers.Confidence).toEqual(['high', 'low']);
  });
});
