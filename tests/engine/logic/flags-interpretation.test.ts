import { parseFlagsToInput } from '../../../src/engine/core/logic/input-interpretation.js';
import { ActiveProtocol } from '../../../src/engine/core/models/active-protocol.js';
import { 
  TEST_PROTOCOL_DEFINITION, 
  MOCK_CORE_TRAILERS,
  makeProtocol, 
  makeProtocolRegistry 
} from '../../../src/engine/testing.js';
import { ProtocolError } from '../../../src/engine/util/errors.js';

import { describe, it, expect, beforeEach } from 'vitest';

describe('parseFlagsToInput (Pure Logic)', () => {
  let protocol: ActiveProtocol;

  beforeEach(() => {
    // Satisfy tests that expect Confidence/Constraint/Related
    protocol = makeProtocol({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
    });
  });

  it('should map all CLI options correctly', () => {
    const options: any = {
      subject: 'feat: add auth',
      body: 'Detailed description',
      constraint: ['must be fast', 'no breaking changes'],
      confidence: 'high',
      related: ['id3'],
    };

    const result = parseFlagsToInput(options, makeProtocolRegistry([protocol]));

    expect(result.subject).toBe('feat: add auth');
    expect(result.body).toBe('Detailed description');
    const mockGroup = result.trailers?.get('mock') || {};
    expect(mockGroup.Constraint).toEqual(['must be fast', 'no breaking changes']);
    expect(mockGroup.Confidence).toEqual(['high']);
    expect(mockGroup.Related).toEqual(['id3']);
  });

  it('should support qualified trailers (Protocol/Key=Value)', () => {
    const p1 = makeProtocol({ name: 'P1', namespace: 'p1', trailers: { Status: { description: 'S' } } });
    const p2 = makeProtocol({ name: 'P2', namespace: 'p2', trailers: { Status: { description: 'S' } } });
    
    const options: any = {
        trailer: ['P1/Status=active', 'P2/Status=pending']
    };

    const result = parseFlagsToInput(options, makeProtocolRegistry([p1, p2]));

    expect(result.trailers?.get('p1').Status).toEqual(['active']);
    expect(result.trailers?.get('p2').Status).toEqual(['pending']);
  });

  it('should default unqualified trailers to the root protocol if it is the only owner', () => {
    const p1 = makeProtocol({ name: 'Root', namespace: '', trailers: { Status: { description: 'S' } } });
    const p2 = makeProtocol({ name: 'NS', namespace: 'ns', trailers: { Other: { description: 'O' } } });
    
    const options: any = {
        trailer: ['Status=active']
    };

    const result = parseFlagsToInput(options, makeProtocolRegistry([p1, p2]));
    expect(result.trailers?.get('root').Status).toEqual(['active']);
  });

  it('should default subject to empty string when undefined', () => {
    const result = parseFlagsToInput({}, makeProtocolRegistry([protocol]));
    expect(result.subject).toBe('');
  });

  it('should leave body undefined when not provided', () => {
    const result = parseFlagsToInput({ subject: 't' }, makeProtocolRegistry([protocol]));
    expect(result.body).toBeUndefined();
  });

  it('should leave array trailers undefined when not provided', () => {
    const result = parseFlagsToInput({ subject: 't' }, makeProtocolRegistry([protocol]));
    expect(result.trailers?.get('mock')?.Constraint).toBeUndefined();
  });

  it('should leave enum trailers undefined when not provided', () => {
    const result = parseFlagsToInput({ subject: 't' }, makeProtocolRegistry([protocol]));
    expect(result.trailers?.get('mock')?.Confidence).toBeUndefined();
  });

  it('should map core trailers dynamically using metadata', () => {
    const options: any = {
      subject: 'dynamic',
      confidence: 'medium',
      constraint: ['c1'],
    };

    const result = parseFlagsToInput(options, makeProtocolRegistry([protocol]));

    const mockGroup = result.trailers?.get('mock') || {};
    expect(mockGroup.Confidence).toEqual(['medium']);
    expect(mockGroup.Constraint).toEqual(['c1']);
  });

  it('should map auto-generated flags for simple custom trailers', () => {
    const customProtocol = makeProtocol(TEST_PROTOCOL_DEFINITION, {
      trailers: { 
          'Squad': { description: '', multivalue: true, validation: 'none' },
          'Team-Name': { description: '', multivalue: true, validation: 'none' }
      },
    });
    const options: any = {
      subject: 'simple',
      squad: 'Alpha',
      teamName: 'Omega',
    };

    const result = parseFlagsToInput(options, makeProtocolRegistry([customProtocol]));

    const mockGroup = result.trailers?.get('mock') || {};
    expect(mockGroup.Squad).toEqual(['Alpha']);
    expect(mockGroup['Team-Name']).toEqual(['Omega']);
  });

  it('should prioritize explicit cli flags over automatic ones', () => {
    const customProtocol = makeProtocol(TEST_PROTOCOL_DEFINITION, {
      trailers: {
          Department: {
            description: 'dept',
            multivalue: false,
            validation: 'none',
            cli: { flag: 'dept' },
          },
      },
    });
    const options: any = {
      subject: 't',
      dept: 'Eng',
    };

    const result = parseFlagsToInput(options, makeProtocolRegistry([customProtocol]));

    const mockGroup = result.trailers?.get('mock') || {};
    expect(mockGroup.Department).toEqual(['Eng']);
  });

  it('should automatically slugify custom trailer keys into CLI flags', () => {
    const customProtocol = makeProtocol(TEST_PROTOCOL_DEFINITION, {
      trailers: {
          'Regulatory-Compliance': {
            description: 'Check for compliance',
            multivalue: true,
          }
      }
    });
    
    const options = {
      subject: 'feat',
      regulatoryCompliance: ['GDPR', 'HIPAA'],
    };

    const result = parseFlagsToInput(options as any, makeProtocolRegistry([customProtocol]));

    const mockGroup = result.trailers?.get('mock') || {};
    expect(mockGroup['Regulatory-Compliance']).toEqual(['GDPR', 'HIPAA']);
  });

  it('should preserve existing trailers when adding custom ones', () => {
    const options: any = {
      subject: 'feat',
      confidence: 'low',
      trailer: ['Confidence=high', 'Department=Eng'],
    };

    const result = parseFlagsToInput(options, makeProtocolRegistry([makeProtocol({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: { 
            ...TEST_PROTOCOL_DEFINITION.trailers, 
            ...MOCK_CORE_TRAILERS,
            'Department': { description: 'D' } 
        }
    })]));

    const mockGroup = result.trailers?.get('mock') || {};
    expect(mockGroup.Confidence).toEqual(['low', 'high']);
    expect(mockGroup.Department).toEqual(['Eng']);
  });
});
