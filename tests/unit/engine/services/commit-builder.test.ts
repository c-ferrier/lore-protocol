import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommitBuilder } from '../../../../src/engine/services/commit-builder.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import {
  MOCK_PROTOCOL_DEFINITION,
  MOCK_CONFIG,
  MOCK_PROTOCOL_CONFIG,
  makeProtocol,
  makeProtocolConfig,
} from '../test-utils.js';
import type { CommitInput } from '../../../../src/engine/types/commit.js';
import type { EngineConfig } from '../../../../src/engine/types/config.js';

const MOCK_ID_KEY = "Mock-id";

// Mock TrailerParser
function createMockTrailerParser() {
  return {
    parse: vi.fn(),
    serialize: vi.fn((trailers: Record<string, string[]>) => {
      const lines: string[] = [];
      // Mock serialization logic: flattens and joins
      const sortedKeys = Object.keys(trailers).sort();
      for (const key of sortedKeys) {
          for (const v of trailers[key]) {
              lines.push(`${key}: ${v}`);
          }
      }
      return lines.join('\n');
    }),
    containsTrailers: vi.fn(),
    extractTrailerBlock: vi.fn(),
  };
}

// Mock IdGenerator
function createMockIdGenerator(id = 'a1b2c3d4') {
  return {
    generate: vi.fn(() => id),
  };
}

describe('CommitBuilder', () => {
  let builder: CommitBuilder;
  let mockParser: ReturnType<typeof createMockTrailerParser>;
  let mockIdGen: ReturnType<typeof createMockIdGenerator>;
  let engineConfig: EngineConfig;
  let protocolRegistry: ProtocolRegistry;

  beforeEach(() => {
    mockParser = createMockTrailerParser();
    mockIdGen = createMockIdGenerator();
    engineConfig = { ...MOCK_CONFIG };

    protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(makeProtocol(MOCK_PROTOCOL_DEFINITION));

    builder = new CommitBuilder(mockParser as any, mockIdGen as any, engineConfig, protocolRegistry);
  });

  describe('build', () => {
    it(`should build a minimal commit with subject and ${MOCK_ID_KEY}`, () => {
      const input: CommitInput = {
        subject: 'feat: add login',
        trailers: { '': { [MOCK_ID_KEY]: ['a1b2c3d4'] } },
      };

      const { message, protocols } = builder.build(input);

      expect(message).toContain('feat: add login');
      expect(message).toContain(`${MOCK_ID_KEY}: a1b2c3d4`);
      expect(protocols.mock.id).toBe('a1b2c3d4');
    });

    it('should include body separated by blank lines', () => {
      const input: CommitInput = {
        subject: 'feat: add login',
        body: 'Detailed description of changes.',
        trailers: { '': { [MOCK_ID_KEY]: ['a1b2c3d4'] } },
      };

      const { message } = builder.build(input);

      expect(message).toBe(`feat: add login\n\nDetailed description of changes.\n\n${MOCK_ID_KEY}: a1b2c3d4`);
    });

    it('should include all trailer types', () => {
      const input: CommitInput = {
        subject: 'feat: full commit',
        trailers: {
          '': {
            Constraint: ['Must use HTTPS', 'No external deps'],
            Confidence: ['high'],
            Related: ['aabbccdd'],
          }
        },
      };

      const { message } = builder.build(input);

      expect(message).toContain('Constraint: Must use HTTPS');
      expect(message).toContain('Constraint: No external deps');
      expect(message).toContain('Confidence: high');
      expect(message).toContain('Related: aabbccdd');
    });

    it(`should auto-generate ${MOCK_ID_KEY}`, () => {
      mockIdGen.generate.mockReturnValue('deadbeef');
      const input: CommitInput = { subject: 'test', trailers: { '': { [MOCK_ID_KEY]: ['a1b2c3d4'] } } };

      const { message, protocols } = builder.build(input);

      expect(message).toContain(`${MOCK_ID_KEY}: deadbeef`);
      expect(protocols.mock.id).toBe('deadbeef');
    });

    it('should use provided existingId instead of generating one', () => {
      const input: CommitInput = { subject: 'amend: update commit', trailers: { '': { [MOCK_ID_KEY]: ['a1b2c3d4'] } } };

      const { message, protocols } = builder.build(input, { mock: 'cafebabe' });

      expect(message).toContain(`${MOCK_ID_KEY}: cafebabe`);
      expect(protocols.mock.id).toBe('cafebabe');
      expect(mockIdGen.generate).not.toHaveBeenCalled();
    });

    it(`should generate new ${MOCK_ID_KEY} when no existingId is provided`, () => {
      const input: CommitInput = { subject: 'new commit', trailers: { '': { [MOCK_ID_KEY]: ['a1b2c3d4'] } } };

      const { protocols } = builder.build(input);

      expect(mockIdGen.generate).toHaveBeenCalledOnce();
      expect(protocols.mock.id).toBe('a1b2c3d4');
    });

    it('should pass correct trailers to serialize', () => {
      const input: CommitInput = {
        subject: 'test',
        trailers: { '': { Confidence: ['medium'] } },
      };

      builder.build(input);

      const passedTrailers = mockParser.serialize.mock.calls[0][0] as Record<string, string[]>;
      expect(passedTrailers[MOCK_ID_KEY]).toEqual(['a1b2c3d4']);
      expect(passedTrailers.Confidence).toEqual(['medium']);
    });

    it('should correctly resolve trailer ownership between explicit and permissive protocols', () => {
      const mixedRegistry = new ProtocolRegistry();
      
      const fredProtocol = makeProtocol(
        { ...MOCK_PROTOCOL_DEFINITION, name: 'Fred', namespace: 'fred', identityKey: 'Fred-id' },
        { trailers: { ...MOCK_PROTOCOL_CONFIG.trailers, permissive: true } }
      );
      const rootProtocol = makeProtocol(
        MOCK_PROTOCOL_DEFINITION,
        { trailers: { ...MOCK_PROTOCOL_CONFIG.trailers, permissive: false } }
      );

      mixedRegistry.register(fredProtocol);
      mixedRegistry.register(rootProtocol);

      const mixedBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, MOCK_CONFIG, mixedRegistry);
      mockIdGen.generate.mockReturnValueOnce('f1').mockReturnValueOnce('l1');

      const input: CommitInput = {
        subject: 'feat: mixed trailers',
        trailers: {
          '': { Confidence: ['high'] },
          'fred': { 'Fred-Level': ['high'] }
        },
      };

      const { message, protocols } = mixedBuilder.build(input);

      // Verify Git output (Hierarchical format)
      expect(message).toContain('fred: Fred-id: f1');
      expect(message).toContain('fred: Fred-Level: high');
      expect(message).toContain('Mock-id: l1');
      expect(message).toContain('Confidence: high');

      // Verify Internal state
      expect(protocols.fred.id).toBe('f1');
      expect(protocols.mock.id).toBe('l1');
    });
  });

  describe('validate', () => {
    it('should return no issues for valid input', () => {
      const input: CommitInput = {
        subject: 'feat: valid commit message',
        trailers: {
          '': { Confidence: ['medium'], [MOCK_ID_KEY]: ['a1b2c3d4'] },
        },
      };

      const issues = builder.validate(input);
      expect(issues).toEqual([]);
    });

    it('should warn when subject exceeds max length', () => {
      const input: CommitInput = {
        subject: 'a'.repeat(80),
        trailers: { '': { [MOCK_ID_KEY]: ['a1b2c3d4'] } },
      };

      const issues = builder.validate(input);
      expect(issues).toContainEqual(expect.objectContaining({
        severity: 'warning',
        rule: 'subject-length',
      }));
    });

    it('should error when subject is empty', () => {
      const input: CommitInput = {
        subject: '',
        trailers: { '': { [MOCK_ID_KEY]: ['a1b2c3d4'] } },
      };

      const issues = builder.validate(input);
      expect(issues).toContainEqual(expect.objectContaining({
        severity: 'error',
        rule: 'subject-required',
      }));
    });

    it('should error on invalid Confidence enum', () => {
      const input: CommitInput = {
        subject: 'test',
        trailers: {
          '': { Confidence: ['super-high'] },
        },
      };

      const issues = builder.validate(input);
      const enumIssue = issues.find(
        (i) => i.rule === 'invalid-enum' && i.message.includes('Confidence'),
      );
      expect(enumIssue).toBeDefined();
      expect(enumIssue!.severity).toBe('error');
    });

    it('should error on invalid mock-id format in references', () => {
      const input: CommitInput = {
        subject: 'test',
        trailers: {
          '': { Related: ['invalid-id'], [MOCK_ID_KEY]: ['a1b2c3d4'] },
        },
      };

      const issues = builder.validate(input);
      const formatIssue = issues.find(i => i.rule === 'reference-format');
      expect(formatIssue).toBeDefined();
    });

    it('should accept valid 8-char hex references', () => {
      const input: CommitInput = {
        subject: 'test',
        trailers: {
          '': { Related: ['abcdef12'] },
        },
      };

      const issues = builder.validate(input);
      expect(issues.filter(i => i.rule === 'invalid-format')).toHaveLength(0);
    });

    it('should check required trailers from protocol config', () => {
      const requiredRegistry = new ProtocolRegistry();
      const requiredProtocol = makeProtocol(
          { ...MOCK_PROTOCOL_DEFINITION, name: 'Strict', namespace: 'st', identityKey: 'Id', trailers: { 'Required-Key': { description: 'R', multivalue: false, required: true } } }
      );
      requiredRegistry.register(requiredProtocol);

      const requiredBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, engineConfig, requiredRegistry);
      
      const input: CommitInput = {
        subject: 'test',
        trailers: { 'st': {} },
      };

      const issues = requiredBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues).toHaveLength(1);
    });

    it('should error on missing required trailers in strict mode', () => {
      const strictConfig: EngineConfig = {
        ...MOCK_CONFIG,
        validation: { ...MOCK_CONFIG.validation, strict: true },
      };
      const strictRegistry = new ProtocolRegistry();
      strictRegistry.register(makeProtocol(MOCK_PROTOCOL_DEFINITION, { trailers: { ...MOCK_PROTOCOL_CONFIG.trailers, required: ['Confidence'] } }));

      const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, strictConfig, strictRegistry);
      const input: CommitInput = { subject: 'test', trailers: { '': { [MOCK_ID_KEY]: ['a1b2c3d4'] } } };

      const issues = strictBuilder.validate(input);
      const requiredIssue = issues.find((i) => i.rule === 'required-trailer');
      expect(requiredIssue).toBeDefined();
      expect(requiredIssue!.severity).toBe('error');
    });

    it('should warn when message exceeds max lines', () => {
      const longBody = 'line\n'.repeat(55);
      const input: CommitInput = { subject: 'test', body: longBody, trailers: { '': { [MOCK_ID_KEY]: ['a1b2c3d4'] } } };

      const issues = builder.validate(input);
      expect(issues).toContainEqual(expect.objectContaining({
        severity: 'warning',
        rule: 'message-length',
      }));
    });

    it('should not warn when message is within line limit', () => {
      const input: CommitInput = { subject: 'test', body: 'Short body', trailers: { '': { [MOCK_ID_KEY]: ['a1b2c3d4'] } } };

      const issues = builder.validate(input);
      expect(issues.filter(i => i.rule === 'message-length')).toHaveLength(0);
    });

    it('should pass with valid required trailer present', () => {
      const requiredConfig: EngineConfig = { ...MOCK_CONFIG };
      const requiredRegistry = new ProtocolRegistry();
      requiredRegistry.register(makeProtocol(MOCK_PROTOCOL_DEFINITION, { trailers: { ...MOCK_PROTOCOL_CONFIG.trailers, required: ['Confidence'] } }));

      const requiredBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, requiredConfig, requiredRegistry);
      const input: CommitInput = { 
          subject: 'test', 
          trailers: { '': { Confidence: ['high'] } } 
      };

      const issues = requiredBuilder.validate(input);
      expect(issues.filter(i => i.rule === 'required-trailer')).toHaveLength(0);
    });

    it('should report missing required custom trailer', () => {
      const configWithDef = {
        ...MOCK_CONFIG,
        trailers: {
          ...MOCK_CONFIG.trailers,
          definitions: {
            Team: { description: 'dept', multivalue: false, validation: 'none', required: true },
          },
        },
      };
      const customProtocol = makeProtocol(MOCK_PROTOCOL_DEFINITION, {
        trailers: {
          ...MOCK_PROTOCOL_CONFIG.trailers,
          definitions: {
            Team: { description: 'dept', multivalue: false, validation: 'none', required: true },
          },
        }
      });
      const customRegistry = new ProtocolRegistry();
      customRegistry.register(customProtocol);

      const customBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, MOCK_CONFIG, customRegistry);
      const input: CommitInput = { subject: 'test', trailers: { '': { [MOCK_ID_KEY]: ['a1b2c3d4'] } } };

      const issues = customBuilder.validate(input);
      expect(issues.filter(i => i.rule === 'required-trailer')).toHaveLength(1);
    });

    it('should report unauthorized trailers (typos) for non-permissive protocols', () => {
        const strictRegistry = new ProtocolRegistry();
        const strictProtocol = makeProtocol(
            { ...MOCK_PROTOCOL_DEFINITION, name: 'Project', namespace: 'Project', identityKey: 'Id', trailers: { 'Id': { description: 'ID', multivalue: false } } },
            { trailers: { ...MOCK_PROTOCOL_CONFIG.trailers, permissive: false } }
        );
        strictRegistry.register(strictProtocol);

        const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, MOCK_CONFIG, strictRegistry);

        const input: CommitInput = {
            subject: 'test',
            trailers: {
                'Project': { 
                    'Id': ['a1b2c3d4'],
                    'Typo-Key': ['junk'] 
                }
            },
        };

        const issues = strictBuilder.validate(input);
        const unauthorizedIssues = issues.filter(i => i.rule === 'unauthorized-trailer');
        expect(unauthorizedIssues).toHaveLength(1);
        expect(unauthorizedIssues[0].message).toContain('Typo-Key');
    });

    it('should NOT report missing required identity key if it has a generator', () => {
      // makeProtocolDefinition adds a hex8 generator by default
      const protocolWithGen = makeProtocol({ name: 'Gen', required: ['Gen-id'] });
      const registry = new ProtocolRegistry();
      registry.register(protocolWithGen);

      const genBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, MOCK_CONFIG, registry);
      const input: CommitInput = { 
          subject: 'test', 
          trailers: { '': { 'Other': ['val'] } } 
      };

      const issues = genBuilder.validate(input);
      expect(issues.filter(i => i.rule === 'required-trailer')).toHaveLength(0);
    });

    it('should report missing required identity key if it has NO generator', () => {
      const protocolNoGen = makeProtocol({ 
          name: 'Manual', 
          trailers: { 'Manual-id': { description: 'id', multivalue: false, validation: 'none', generator: 'none' } } 
      }, {
          trailers: { required: ['Manual-id'] }
      });
      const registry = new ProtocolRegistry();
      registry.register(protocolNoGen);

      const manualBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, MOCK_CONFIG, registry);
      const input: CommitInput = { subject: 'test', trailers: { '': {} } };

      const issues = manualBuilder.validate(input);
      expect(issues.filter(i => i.rule === 'required-trailer')).toHaveLength(1);
    });
  });
});
