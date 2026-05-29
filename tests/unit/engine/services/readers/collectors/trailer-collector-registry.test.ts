import { describe, it, expect } from 'vitest';
import { TrailerCollectorRegistry } from '../../../../../../src/engine/services/readers/collectors/trailer-collector-registry.js';
import { Protocol } from '../../../../../../src/engine/services/protocol.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG, makeProtocol } from '../../../test-utils.js';

describe('TrailerCollectorRegistry', () => {
  it('should create default collectors for core trailers', () => {
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION);
    const registry = new TrailerCollectorRegistry(protocol);
    const collectors = registry.getCollectors();
    
    // Default core trailers count in Mock (Constraint, Confidence, Related, Ref, Supersedes, Depends-on, Ref)
    // Actually it is: Constraint, Confidence, Related, Supersedes, Depends-on, Ref (6)
    // Plus any others... let's count:
    // 1. Constraint
    // 2. Confidence
    // 3. Related
    // 4. Supersedes
    // 5. Depends-on
    // 6. Ref
    expect(collectors.length).toBe(6);
    expect(collectors.map(c => c.key)).toContain('Constraint');
    expect(collectors.map(c => c.key)).toContain('Confidence');
  });

  it('should add custom collectors from definitions', () => {
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
      trailers: {
        definitions: {
          'Project': { description: 'Project name', multivalue: false, validation: 'none' as const },
          'Squad': { description: 'Squad name', multivalue: true, validation: 'none' as const }
        }
      }
    });
    const registry = new TrailerCollectorRegistry(protocol);
    const collectors = registry.getCollectors();
    
    expect(collectors.length).toBe(8); // 6 core + 2 custom
    expect(collectors.map(c => c.key)).toContain('Project');
    expect(collectors.map(c => c.key)).toContain('Squad');
  });

  it('should handle multi-value enum collectors', () => {
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
      trailers: {
        definitions: {
          'Features': { 
            description: 'Features', 
            multivalue: true, 
            validation: 'values' as const,
            values: { f1: { description: 'f1' }, f2: { description: 'f2' } }
          },
        }
      }
    });
    const registry = new TrailerCollectorRegistry(protocol);
    const collectors = registry.getCollectors();
    const featureCollector = collectors.find(c => c.key === 'Features');
    
    expect(featureCollector).toBeDefined();
    // Multi-value enums use MultiValueTrailerCollector
    expect(featureCollector?.constructor.name).toBe('MultiValueTrailerCollector');
  });

  it('should create collectors for simple custom trailers', () => {
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
      trailers: {
        custom: ['Team'],
        definitions: {
          'Project': { description: 'Project name', multivalue: false, validation: 'none' as const }
        }
      }
    });
    const registry = new TrailerCollectorRegistry(protocol);
    const collectors = registry.getCollectors();
    
    // 6 core + 1 rich def (Project) + 1 simple list (Team) = 8
    expect(collectors.length).toBe(8);
    expect(collectors.map(c => c.key)).toContain('Team');
  });

  it('should sort collectors based on metadata order', () => {
    const protocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
      trailers: {
        definitions: {
          'First': { description: 'f', multivalue: false, validation: 'none' as const, prompt: { order: 1 } },
          'Last': { description: 'l', multivalue: false, validation: 'none' as const, prompt: { order: 10000 } }
        }
      }
    });
    const registry = new TrailerCollectorRegistry(protocol);
    const collectors = registry.getCollectors();
    const keys = collectors.map(c => c.key);

    expect(keys[0]).toBe('First');
    expect(keys[keys.length - 1]).toBe('Last');
  });
});
