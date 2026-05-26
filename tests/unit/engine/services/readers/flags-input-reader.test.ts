import { describe, it, expect, beforeEach } from 'vitest';
import { FlagsInputReader } from '../../../../../src/engine/services/readers/flags-input-reader.js';
import { Protocol } from '../../../../../src/engine/services/protocol.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG } from '../../test-utils.js';
import type { CommitCommandOptions } from '../../../../../src/engine/services/commit-input-resolver.js';

describe('FlagsInputReader', () => {
  let protocol: Protocol;

  beforeEach(() => {
    protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG);
  });

  it('should map all CLI options correctly', async () => {
    const options: CommitCommandOptions = {
      subject: 'feat: add auth',
      body: 'Detailed description',
      constraint: ['must be fast', 'no breaking changes'],
      confidence: 'high',
      related: ['id3'],
    };

    const reader = new FlagsInputReader(options, protocol);
    const result = await reader.read();

    expect(result.subject).toBe('feat: add auth');
    expect(result.body).toBe('Detailed description');
    expect(result.trailers?.Constraint).toEqual(['must be fast', 'no breaking changes']);
    expect(result.trailers?.Confidence).toEqual(['high']);
    expect(result.trailers?.Related).toEqual(['id3']);
  });

  it('should default subject to empty string when undefined', async () => {
    const reader = new FlagsInputReader({}, protocol);
    const result = await reader.read();
    expect(result.subject).toBe('');
  });

  it('should leave body undefined when not provided', async () => {
    const reader = new FlagsInputReader({ subject: 't' }, protocol);
    const result = await reader.read();
    expect(result.body).toBeUndefined();
  });

  it('should leave array trailers undefined when not provided', async () => {
    const reader = new FlagsInputReader({ subject: 't' }, protocol);
    const result = await reader.read();
    expect(result.trailers?.Constraint).toBeUndefined();
  });

  it('should leave enum trailers undefined when not provided', async () => {
    const reader = new FlagsInputReader({ subject: 't' }, protocol);
    const result = await reader.read();
    expect(result.trailers?.Confidence).toBeUndefined();
  });

  it('should handle only subject and one trailer', async () => {
    const options: CommitCommandOptions = {
      subject: 'quick fix',
      confidence: 'low',
    };

    const reader = new FlagsInputReader(options, protocol);
    const result = await reader.read();

    expect(result.subject).toBe('quick fix');
    expect(result.trailers?.Confidence).toEqual(['low']);
    expect(result.trailers?.Constraint).toBeUndefined();
  });

  it('should parse custom trailers correctly', async () => {
    const options: CommitCommandOptions = {
      subject: 'feat',
      trailer: ['Team=Gamma', 'Ticket:123', 'Foo=Bar=Baz'],
    };

    const reader = new FlagsInputReader(options, protocol);
    const result = await reader.read();

    expect(result.trailers?.Team).toEqual(['Gamma']);
    expect(result.trailers?.Ticket).toEqual(['123']);
    expect(result.trailers?.Foo).toEqual(['Bar=Baz']);
  });

  it('should allow core trailers in the custom flag during parsing (validation caught later)', async () => {
    const options: CommitCommandOptions = {
      subject: 'feat',
      trailer: ['Confidence=high'],
    };

    const reader = new FlagsInputReader(options, protocol);
    const result = await reader.read();
    expect(result.trailers?.Confidence).toEqual(['high']);
  });

  it('should map core trailers dynamically using metadata', async () => {
    const options: any = {
      subject: 'dynamic',
      confidence: 'medium',
      constraint: ['c1'],
    };

    const reader = new FlagsInputReader(options, protocol);
    const result = await reader.read();

    expect(result.trailers?.Confidence).toEqual(['medium']);
    expect(result.trailers?.Constraint).toEqual(['c1']);
  });

  it('should map auto-generated flags for simple custom trailers', async () => {
    const config = {
      ...MOCK_CONFIG,
      trailers: { ...MOCK_CONFIG.trailers, custom: ['Squad', 'Team-Name'] },
    };
    const customProtocol = new Protocol(MOCK_PROTOCOL_DEFINITION, config);
    const options: any = {
      subject: 't',
      squad: ['Alpha'],
      teamName: ['Omega'],
    };

    const reader = new FlagsInputReader(options, customProtocol);
    const result = await reader.read();

    expect(result.trailers?.Squad).toEqual(['Alpha']);
    expect(result.trailers?.['Team-Name']).toEqual(['Omega']);
  });

  it('should prioritize explicit cli flags over automatic ones', async () => {
    const config = {
      ...MOCK_CONFIG,
      trailers: {
        ...MOCK_CONFIG.trailers,
        definitions: {
          Department: {
            description: 'dept',
            multivalue: false,
            validation: 'none' as const,
            cli: { flag: 'dept' },
          },
        },
      },
    };
    const customProtocol = new Protocol(MOCK_PROTOCOL_DEFINITION, config);
    const options: any = {
      subject: 't',
      dept: 'Eng',
    };

    const reader = new FlagsInputReader(options, customProtocol);
    const result = await reader.read();

    expect(result.trailers?.Department).toEqual(['Eng']);
  });

  it('should automatically slugify custom trailer keys into CLI flags', async () => {
    const customConfig = {
      ...MOCK_CONFIG,
      trailers: {
        ...MOCK_CONFIG.trailers,
        definitions: {
          'Regulatory-Compliance': {
            description: 'Check for compliance',
            multivalue: true,
          }
        }
      }
    };
    const customProtocol = new Protocol(MOCK_PROTOCOL_DEFINITION, customConfig);
    
    const options = {
      subject: 'feat',
      regulatoryCompliance: ['GDPR', 'HIPAA'],
    };

    const reader = new FlagsInputReader(options as any, customProtocol);
    const result = await reader.read();

    expect(result.trailers?.['Regulatory-Compliance']).toEqual(['GDPR', 'HIPAA']);
  });

  it('should preserve existing trailers when adding custom ones', async () => {
    const options: CommitCommandOptions = {
      subject: 'feat',
      confidence: 'low',
      trailer: ['Confidence=high', 'Department=Eng'],
    };

    const reader = new FlagsInputReader(options, protocol);
    const result = await reader.read();

    expect(result.trailers?.Confidence).toEqual(['low', 'high']);
    expect(result.trailers?.Department).toEqual(['Eng']);
  });
});
