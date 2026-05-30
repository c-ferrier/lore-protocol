import { describe, it, expect, beforeEach } from 'vitest';
import { FlagsInputReader } from '../../../../src/engine/services/readers/flags-input-reader.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import {
  TEST_PROTOCOL_DEFINITION,
  TEST_ENGINE_CONFIG,
  makeProtocolConfig,
  makeProtocol
} from '../../engine-test-utils.js';
import type { CommitCommandOptions } from '../../../../src/engine/services/commit-input-resolver.js';

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

    const reader = new FlagsInputReader(options, [protocol]);
    const result = await reader.read();

    expect(result.subject).toBe('feat: add auth');
    expect(result.body).toBe('Detailed description');
    const root = result.trailers[''] || {};
    expect(root.Constraint).toEqual(['must be fast', 'no breaking changes']);
    expect(root.Confidence).toEqual(['high']);
    expect(root.Related).toEqual(['id3']);
  });

  it('should default subject to empty string when undefined', async () => {
    const reader = new FlagsInputReader({}, [protocol]);
    const result = await reader.read();
    expect(result.subject).toBe('');
  });

  it('should leave body undefined when not provided', async () => {
    const reader = new FlagsInputReader({ subject: 't' }, [protocol]);
    const result = await reader.read();
    expect(result.body).toBeUndefined();
  });

  it('should leave array trailers undefined when not provided', async () => {
    const reader = new FlagsInputReader({ subject: 't' }, [protocol]);
    const result = await reader.read();
    const root = result.trailers[''] || {};
    expect(root.Constraint).toBeUndefined();
  });

  it('should leave enum trailers undefined when not provided', async () => {
    const reader = new FlagsInputReader({ subject: 't' }, [protocol]);
    const result = await reader.read();
    const root = result.trailers[''] || {};
    expect(root.Confidence).toBeUndefined();
  });

  it('should handle only subject and one trailer', async () => {
    const options: CommitCommandOptions = {
      subject: 'quick fix',
      confidence: 'low',
    };

    const reader = new FlagsInputReader(options, [protocol]);
    const result = await reader.read();

    expect(result.subject).toBe('quick fix');
    const root = result.trailers[''] || {};
    expect(root.Confidence).toEqual(['low']);
    expect(root.Constraint).toBeUndefined();
  });

  it('should parse custom trailers correctly', async () => {
    const options: CommitCommandOptions = {
      subject: 'feat',
      trailer: ['Team=Gamma', 'Ticket:123', 'Foo=Bar=Baz'],
    };

    const reader = new FlagsInputReader(options, [protocol]);
    const result = await reader.read();

    const root = result.trailers[''] || {};
    expect(root.Team).toEqual(['Gamma']);
    expect(root.Ticket).toEqual(['123']);
    expect(root.Foo).toEqual(['Bar=Baz']);
  });

  it('should allow core trailers in the custom flag during parsing (validation caught later)', async () => {
    const options: CommitCommandOptions = {
      subject: 'feat',
      trailer: ['Confidence=high'],
    };

    const reader = new FlagsInputReader(options, [protocol]);
    const result = await reader.read();
    const root = result.trailers[''] || {};
    expect(root.Confidence).toEqual(['high']);
  });

  it('should map core trailers dynamically using metadata', async () => {
    const options: any = {
      subject: 'dynamic',
      confidence: 'medium',
      constraint: ['c1'],
    };

    const reader = new FlagsInputReader(options, [protocol]);
    const result = await reader.read();

    const root = result.trailers[''] || {};
    expect(root.Confidence).toEqual(['medium']);
    expect(root.Constraint).toEqual(['c1']);
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

    const reader = new FlagsInputReader(options, [customProtocol]);
    const result = await reader.read();

    const root = result.trailers[''] || {};
    expect(root.Squad).toEqual(['Alpha']);
    expect(root['Team-Name']).toEqual(['Omega']);
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

    const reader = new FlagsInputReader(options, [customProtocol]);
    const result = await reader.read();

    const root = result.trailers[''] || {};
    expect(root.Department).toEqual(['Eng']);
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

    const reader = new FlagsInputReader(options as any, [customProtocol]);
    const result = await reader.read();

    const root = result.trailers[''] || {};
    expect(root['Regulatory-Compliance']).toEqual(['GDPR', 'HIPAA']);
  });

  it('should preserve existing trailers when adding custom ones', async () => {
    const options: CommitCommandOptions = {
      subject: 'feat',
      confidence: 'low',
      trailer: ['Confidence=high', 'Department=Eng'],
    };

    const reader = new FlagsInputReader(options, [protocol]);
    const result = await reader.read();

    const root = result.trailers[''] || {};
    expect(root.Confidence).toEqual(['low', 'high']);
    expect(root.Department).toEqual(['Eng']);
  });
});
