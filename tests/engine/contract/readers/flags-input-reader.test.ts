import { describe, it, expect, beforeEach } from 'vitest';
import { FlagsInputReader } from '../../../../src/engine/services/readers/flags-input-reader.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import {
  TEST_PROTOCOL_DEFINITION,
  TEST_ENGINE_CONFIG,
  makeProtocolConfig,
  makeProtocol,
  makeProtocolRegistry
} from '../../engine-test-utils.js';
import type { CommitCommandOptions } from '../../../../src/engine/services/commit-input-resolver.js';
import { ProtocolError } from '../../../../src/engine/util/errors.js';

describe('FlagsInputReader', () => {
  let protocol: Protocol;

  beforeEach(() => {
    protocol = makeProtocol(TEST_PROTOCOL_DEFINITION);
  });

  it('should map all CLI options correctly', async () => {
    const options: CommitCommandOptions = {
      subject: 'feat: add auth',
      body: 'Detailed description',
      constraint: ['must be fast', 'no breaking changes'],
      confidence: 'high',
      related: ['id3'],
    };

    const reader = new FlagsInputReader(options, makeProtocolRegistry([protocol]));
    const result = await reader.read();

    expect(result.subject).toBe('feat: add auth');
    expect(result.body).toBe('Detailed description');
    const mockGroup = result.trailers.get('mock') || {};
    expect(mockGroup.Constraint).toEqual(['must be fast', 'no breaking changes']);
    expect(mockGroup.Confidence).toEqual(['high']);
    expect(mockGroup.Related).toEqual(['id3']);
  });

  it('should support qualified trailers (Protocol/Key=Value)', async () => {
    const p1 = makeProtocol({ name: 'P1', namespace: 'p1', trailers: { Status: { description: 'S' } } });
    const p2 = makeProtocol({ name: 'P2', namespace: 'p2', trailers: { Status: { description: 'S' } } });
    
    const options: CommitCommandOptions = {
        trailer: ['P1/Status=active', 'P2/Status=pending']
    };

    const reader = new FlagsInputReader(options, makeProtocolRegistry([p1, p2]));
    const result = await reader.read();

    expect(result.trailers.get('p1').Status).toEqual(['active']);
    expect(result.trailers.get('p2').Status).toEqual(['pending']);
  });

  it('should throw an error for ambiguous unqualified trailers', async () => {
    const p1 = makeProtocol({ name: 'P1', trailers: { Status: { description: 'S' } } });
    const p2 = makeProtocol({ name: 'P2', trailers: { Status: { description: 'S' } } }, { permissive: false } as any);
    
    const options: CommitCommandOptions = {
        trailer: ['Status=active']
    };

    const reader = new FlagsInputReader(options, makeProtocolRegistry([p1, p2]));
    await expect(reader.read()).rejects.toThrow(ProtocolError);
  });

  it('should default unqualified trailers to the host protocol if it is the only owner', async () => {
    const p1 = makeProtocol({ name: 'P1', trailers: { Status: { description: 'S' } } }, { permissive: false } as any);
    const p2 = makeProtocol({ name: 'P2', trailers: { Other: { description: 'O' } } }, { permissive: false } as any);
    
    const options: CommitCommandOptions = {
        trailer: ['Status=active']
    };

    const reader = new FlagsInputReader(options, makeProtocolRegistry([p1, p2]));
    const result = await reader.read();
    expect(result.trailers.get('p1').Status).toEqual(['active']);
  });

  it('should default subject to empty string when undefined', async () => {
    const reader = new FlagsInputReader({}, makeProtocolRegistry([protocol]));
    const result = await reader.read();
    expect(result.subject).toBe('');
  });

  it('should leave body undefined when not provided', async () => {
    const reader = new FlagsInputReader({ subject: 't' }, makeProtocolRegistry([protocol]));
    const result = await reader.read();
    expect(result.body).toBeUndefined();
  });

  it('should leave array trailers undefined when not provided', async () => {
    const reader = new FlagsInputReader({ subject: 't' }, makeProtocolRegistry([protocol]));
    const result = await reader.read();
    const mockGroup = result.trailers.get('mock') || {};
    expect(mockGroup.Constraint).toBeUndefined();
  });

  it('should leave enum trailers undefined when not provided', async () => {
    const reader = new FlagsInputReader({ subject: 't' }, makeProtocolRegistry([protocol]));
    const result = await reader.read();
    const mockGroup = result.trailers.get('mock') || {};
    expect(mockGroup.Confidence).toBeUndefined();
  });

  it('should handle only subject and one trailer', async () => {
    const options: CommitCommandOptions = {
      subject: 'quick fix',
      confidence: 'low',
    };

    const reader = new FlagsInputReader(options, makeProtocolRegistry([protocol]));
    const result = await reader.read();

    expect(result.subject).toBe('quick fix');
    const mockGroup = result.trailers.get('mock') || {};
    expect(mockGroup.Confidence).toEqual(['low']);
    expect(mockGroup.Constraint).toBeUndefined();
  });

  it('should parse custom trailers correctly', async () => {
    const options: CommitCommandOptions = {
      subject: 'feat',
      trailer: ['Team=Gamma', 'Ticket:123', 'Foo=Bar=Baz'],
    };

    const reader = new FlagsInputReader(options, makeProtocolRegistry([protocol]));
    const result = await reader.read();

    const mockGroup = result.trailers.get('mock') || {};
    expect(mockGroup.Team).toEqual(['Gamma']);
    expect(mockGroup.Ticket).toEqual(['123']);
    expect(mockGroup.Foo).toEqual(['Bar=Baz']);
  });

  it('should allow core trailers in the custom flag during parsing (validation caught later)', async () => {
    const options: CommitCommandOptions = {
      subject: 'feat',
      trailer: ['Confidence=high'],
    };

    const reader = new FlagsInputReader(options, makeProtocolRegistry([protocol]));
    const result = await reader.read();
    const mockGroup = result.trailers.get('mock') || {};
    expect(mockGroup.Confidence).toEqual(['high']);
  });

  it('should map core trailers dynamically using metadata', async () => {
    const options: any = {
      subject: 'dynamic',
      confidence: 'medium',
      constraint: ['c1'],
    };

    const reader = new FlagsInputReader(options, makeProtocolRegistry([protocol]));
    const result = await reader.read();

    const mockGroup = result.trailers.get('mock') || {};
    expect(mockGroup.Confidence).toEqual(['medium']);
    expect(mockGroup.Constraint).toEqual(['c1']);
  });

  it('should map auto-generated flags for simple custom trailers', async () => {
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

    const reader = new FlagsInputReader(options, makeProtocolRegistry([customProtocol]));
    const result = await reader.read();

    const mockGroup = result.trailers.get('mock') || {};
    expect(mockGroup.Squad).toEqual(['Alpha']);
    expect(mockGroup['Team-Name']).toEqual(['Omega']);
  });

  it('should prioritize explicit cli flags over automatic ones', async () => {
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

    const reader = new FlagsInputReader(options, makeProtocolRegistry([customProtocol]));
    const result = await reader.read();

    const mockGroup = result.trailers.get('mock') || {};
    expect(mockGroup.Department).toEqual(['Eng']);
  });

  it('should automatically slugify custom trailer keys into CLI flags', async () => {
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

    const reader = new FlagsInputReader(options as any, makeProtocolRegistry([customProtocol]));
    const result = await reader.read();

    const mockGroup = result.trailers.get('mock') || {};
    expect(mockGroup['Regulatory-Compliance']).toEqual(['GDPR', 'HIPAA']);
  });

  it('should preserve existing trailers when adding custom ones', async () => {
    const options: CommitCommandOptions = {
      subject: 'feat',
      confidence: 'low',
      trailer: ['Confidence=high', 'Department=Eng'],
    };

    const reader = new FlagsInputReader(options, makeProtocolRegistry([protocol]));
    const result = await reader.read();

    const mockGroup = result.trailers.get('mock') || {};
    expect(mockGroup.Confidence).toEqual(['low', 'high']);
    expect(mockGroup.Department).toEqual(['Eng']);
  });
});
