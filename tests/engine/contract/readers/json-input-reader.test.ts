import { describe, it, expect, beforeEach } from 'vitest';
import { JsonInputReader } from '../../../../src/engine/services/readers/json-input-reader.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { makeProtocol } from '../../engine-test-utils.js';


describe('JsonInputReader', () => {
  describe('valid JSON', () => {
    it('should parse a complete JSON input with all trailers', async () => {
      const input = {
        subject: 'fix bug in parser',
        body: 'Detailed explanation',
        trailers: {
          Constraint: ['must preserve backward compat'],
          Rejected: ['approach A | too complex'],
          Confidence: 'medium',
          'Scope-risk': 'narrow',
          Reversibility: 'clean',
          Directive: ['use new API'],
          Tested: ['unit tests pass'],
          'Not-tested': ['load testing'],
          Supersedes: ['abcd1234'],
          'Depends-on': ['dead0000'],
          Related: ['beef1234'],
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
      const result = await reader.read();

      expect(result.subject).toBe('fix bug in parser');
      expect(result.body).toBe('Detailed explanation');
      expect(result.trailers.get('').Constraint).toEqual(['must preserve backward compat']);
      expect(result.trailers.get('').Rejected).toEqual(['approach A | too complex']);
      expect(result.trailers.get('').Confidence).toEqual(['medium']);
      expect(result.trailers.get('')?.['Scope-risk']).toEqual(['narrow']);
      expect(result.trailers.get('').Reversibility).toEqual(['clean']);
      expect(result.trailers.get('').Directive).toEqual(['use new API']);
      expect(result.trailers.get('').Tested).toEqual(['unit tests pass']);
      expect(result.trailers.get('')?.['Not-tested']).toEqual(['load testing']);
      expect(result.trailers.get('').Supersedes).toEqual(['abcd1234']);
      expect(result.trailers.get('')?.['Depends-on']).toEqual(['dead0000']);
      expect(result.trailers.get('').Related).toEqual(['beef1234']);
    });

    it('should handle hierarchical JSON by Protocol Name', async () => {
        const localRegistry = new ProtocolRegistry();
        localRegistry.register(makeProtocol({ name: 'Project', namespace: 'p1', trailers: { Team: { description: 'T' } } }));
        
        const input = {
            subject: 'test',
            trailers: {
                'Project': { 'Team': 'Backend' }
            }
        };

        const reader = new JsonInputReader(JSON.stringify(input), localRegistry);
        const result = await reader.read();

        expect(result.trailers.get('project').Team).toEqual(['Backend']);
        });
    it('should throw ProtocolError for unknown protocol in hierarchical JSON', async () => {
        const input = {
            subject: 'test',
            trailers: {
                'Ghost': { 'Key': 'value' }
            }
        };
        const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
        await expect(reader.read()).rejects.toThrow(/Unknown protocol "Ghost"/);
    });

    it('should parse minimal JSON with only subject', async () => {
      const input = { subject: 'minimal commit' };

      const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
      const result = await reader.read();

      expect(result.subject).toBe('minimal commit');
      expect(result.body).toBeUndefined();
      expect(result.trailers.size).toBe(0);
    });

    it('should parse JSON with subject and body but no trailers', async () => {
      const input = { subject: 'with body', body: 'Some body text' };

      const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
      const result = await reader.read();

      expect(result.subject).toBe('with body');
      expect(result.body).toBe('Some body text');
      expect(result.trailers.size).toBe(0);
    });

    it('should parse JSON with empty trailers object', async () => {
      const input = { subject: 'with empty trailers', trailers: {} };

      const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
      const result = await reader.read();

      expect(result.subject).toBe('with empty trailers');
      expect(result.trailers.size).toBe(0);
    });

    it('should default subject to empty string when not a string', async () => {
      const input = { subject: 123 };

      const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
      const result = await reader.read();

      expect(result.trailers.size).toBe(0);
      });




    it('should ignore body when not a string', async () => {
      const input = { subject: 'test', body: 42 };

      const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
      const result = await reader.read();

      expect(result.body).toBeUndefined();
    });
  });

  describe('array parsing', () => {
    it('should filter non-string values from arrays', async () => {
      const input = {
        subject: 'test',
        trailers: {
          Constraint: ['valid', 123, 'also valid', null, true],
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
      const result = await reader.read();

      expect(result.trailers.get('').Constraint).toEqual(['valid', 'also valid']);
    });

    it('should coerce a single string trailer value to an array', async () => {
      const input = {
        subject: 'test',
        trailers: {
          Constraint: 'single constraint',
          Directive: '[until:2026-06] Remove before release',
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
      const result = await reader.read();

      expect(result.trailers.get('').Constraint).toEqual(['single constraint']);
      expect(result.trailers.get('').Directive).toEqual(['[until:2026-06] Remove before release']);
    });

    it('should return undefined for non-string non-array trailer values', async () => {
      const input = {
        subject: 'test',
        trailers: {
          Constraint: 123,
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
      const result = await reader.read();

      expect(result.trailers.get('')?.Constraint).toBeUndefined();
    });

  });

  describe('custom trailers', () => {
    it('should collect unknown trailer keys at the top level', async () => {
      const input = {
        subject: 'test',
        trailers: {
          'Assisted-by': 'Gemini:CLI',
          Confidence: 'high',
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
      const result = await reader.read();

      expect(result.trailers.get('')?.['Assisted-by']).toEqual(['Gemini:CLI']);
      expect(result.trailers.get('').Confidence).toEqual(['high']);
    });

    it('should collect multiple custom trailers', async () => {
      const input = {
        subject: 'test',
        trailers: {
          'Assisted-by': 'Gemini:CLI',
          'Ticket': ['PROJ-123', 'PROJ-456'],
          Constraint: ['some constraint'],
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
      const result = await reader.read();

      expect(result.trailers.get('')?.['Assisted-by']).toEqual(['Gemini:CLI']);
      expect(result.trailers.get('').Ticket).toEqual(['PROJ-123', 'PROJ-456']);
      expect(result.trailers.get('').Constraint).toEqual(['some constraint']);
    });

    it('should skip custom trailers with non-string values', async () => {
      const input = {
        subject: 'test',
        trailers: {
          'Valid-custom': 'value',
          'Invalid-custom': 42,
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
      const result = await reader.read();

      expect(result.trailers.get('')?.['Valid-custom']).toEqual(['value']);
      expect(result.trailers.get('')?.['Invalid-custom']).toBeUndefined();
    });
  });

  describe('enum parsing', () => {
    it('should return array values for enum trailers', async () => {
      const input = {
        subject: 'test',
        trailers: {
          Confidence: 'high',
          'Scope-risk': 'wide',
          Reversibility: 'irreversible',
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
      const result = await reader.read();

      expect(result.trailers.get('').Confidence).toEqual(['high']);
      expect(result.trailers.get('')?.['Scope-risk']).toEqual(['wide']);
      expect(result.trailers.get('').Reversibility).toEqual(['irreversible']);
    });

    it('should return undefined for non-string enum values', async () => {
      const input = {
        subject: 'test',
        trailers: {
          Confidence: 42,
          'Scope-risk': true,
          Reversibility: null,
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input), new ProtocolRegistry());
      const result = await reader.read();

      expect(result.trailers.get('')?.Confidence).toBeUndefined();
      expect(result.trailers.get('')?.['Scope-risk']).toBeUndefined();
      expect(result.trailers.get('')?.Reversibility).toBeUndefined();
    });
  });

  describe('invalid JSON', () => {
    it('should throw on malformed JSON', async () => {
      const reader = new JsonInputReader('not valid json {{{', new ProtocolRegistry());

      await expect(reader.read()).rejects.toThrow();
    });

    it('should throw on empty string', async () => {
      const reader = new JsonInputReader('', new ProtocolRegistry());

      await expect(reader.read()).rejects.toThrow();
    });
  });
});
