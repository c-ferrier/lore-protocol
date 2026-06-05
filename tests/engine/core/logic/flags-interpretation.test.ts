import { parseFlagsToInput } from '../../../..//src/engine/core/logic/input-interpretation.js';
import { 
  TEST_PROTOCOL_DEFINITION, 
  MOCK_CORE_TRAILERS,
  makeMockContext, 
  makeProtocolRegistry 
} from '../../../..//src/engine/testing.js';
import { ProtocolError } from '../../../..//src/engine/util/errors.js';
import type { ProtocolContext } from '../../../..//src/engine/core/types/protocol-definition.js';

import { describe, it, expect, beforeEach } from 'vitest';

describe('parseFlagsToInput (Pure Logic)', () => {
  let protocol: ProtocolContext;

  beforeEach(() => {
    // Satisfy tests that expect Confidence/Constraint/Related
    protocol = makeMockContext({
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

    const result = parseFlagsToInput(options, makeProtocolRegistry([protocol as any]));

    expect(result.subject).toBe('feat: add auth');
    expect(result.body).toBe('Detailed description');
    const mockGroup = result.trailers?.get('mock') || {};
    expect(mockGroup.Constraint).toEqual(['must be fast', 'no breaking changes']);
    expect(mockGroup.Confidence).toEqual(['high']);
    expect(mockGroup.Related).toEqual(['id3']);
  });

  it('should support qualified trailers (Protocol/Key=Value)', () => {
    const p1 = makeMockContext({ name: 'P1', namespace: 'p1', trailers: { Status: { description: 'S' } } });
    const p2 = makeMockContext({ name: 'P2', namespace: 'p2', trailers: { Status: { description: 'S' } } });
    
    const options: any = {
        trailer: ['P1/Status=active', 'P2/Status=pending']
    };

    const result = parseFlagsToInput(options, makeProtocolRegistry([p1 as any, p2 as any]));

    expect(result.trailers?.get('p1').Status).toEqual(['active']);
    expect(result.trailers?.get('p2').Status).toEqual(['pending']);
  });

  it('should default unqualified trailers to the root protocol if it is the only owner', () => {
    const p1 = makeMockContext({ name: 'Root', namespace: '', trailers: { Status: { description: 'S' } } });
    const p2 = makeMockContext({ name: 'NS', namespace: 'ns', trailers: { Other: { description: 'O' } } });
    
    const options: any = {
        trailer: ['Status=active']
    };

    const result = parseFlagsToInput(options, makeProtocolRegistry([p1 as any, p2 as any]));
    expect(result.trailers?.get('root').Status).toEqual(['active']);
  });

  it('should default subject to empty string when undefined', () => {
    const result = parseFlagsToInput({}, makeProtocolRegistry([protocol as any]));
    expect(result.subject).toBe('');
  });

  it('should leave body undefined when not provided', () => {
    const result = parseFlagsToInput({ subject: 't' }, makeProtocolRegistry([protocol as any]));
    expect(result.body).toBeUndefined();
  });

  it('should leave array trailers undefined when not provided', () => {
    const result = parseFlagsToInput({ subject: 't' }, makeProtocolRegistry([protocol as any]));
    expect(result.trailers?.get('mock')?.Constraint).toBeUndefined();
  });

  it('should leave enum trailers undefined when not provided', () => {
    const result = parseFlagsToInput({ subject: 't' }, makeProtocolRegistry([protocol as any]));
    expect(result.trailers?.get('mock')?.Confidence).toBeUndefined();
  });

  it('should map core trailers dynamically using metadata', () => {
    const options: any = {
      subject: 'dynamic',
      confidence: 'medium',
      constraint: ['c1'],
    };

    const result = parseFlagsToInput(options, makeProtocolRegistry([protocol as any]));

    const mockGroup = result.trailers?.get('mock') || {};
    expect(mockGroup.Confidence).toEqual(['medium']);
    expect(mockGroup.Constraint).toEqual(['c1']);
  });

  it('should map auto-generated flags for simple custom trailers', () => {
    const customProtocol = makeMockContext({
      ...TEST_PROTOCOL_DEFINITION,
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

    const result = parseFlagsToInput(options, makeProtocolRegistry([customProtocol as any]));

    const mockGroup = result.trailers?.get('mock') || {};
    expect(mockGroup.Squad).toEqual(['Alpha']);
    expect(mockGroup['Team-Name']).toEqual(['Omega']);
  });

  it('should prioritize explicit cli flags over automatic ones', () => {
    const customProtocol = makeMockContext({
      ...TEST_PROTOCOL_DEFINITION,
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

    const result = parseFlagsToInput(options, makeProtocolRegistry([customProtocol as any]));

    const mockGroup = result.trailers?.get('mock') || {};
    expect(mockGroup.Department).toEqual(['Eng']);
  });

  it('should automatically slugify custom trailer keys into CLI flags', () => {
    const customProtocol = makeMockContext({
      ...TEST_PROTOCOL_DEFINITION,
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

    const result = parseFlagsToInput(options as any, makeProtocolRegistry([customProtocol as any]));

    const mockGroup = result.trailers?.get('mock') || {};
    expect(mockGroup['Regulatory-Compliance']).toEqual(['GDPR', 'HIPAA']);
  });

  it('should preserve existing trailers when adding custom ones', () => {
    const options: any = {
      subject: 'feat',
      confidence: 'low',
      trailer: ['Confidence=high', 'Department=Eng'],
    };

    const result = parseFlagsToInput(options, makeProtocolRegistry([makeMockContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: { 
            ...TEST_PROTOCOL_DEFINITION.trailers, 
            ...MOCK_CORE_TRAILERS,
            'Department': { description: 'D' } 
        }
    }) as any]));

    const mockGroup = result.trailers?.get('mock') || {};
    expect(mockGroup.Confidence).toEqual(['low', 'high']);
    expect(mockGroup.Department).toEqual(['Eng']);
  });
});
