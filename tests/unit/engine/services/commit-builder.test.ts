import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommitBuilder } from '../../../../src/engine/services/commit-builder.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { LoreProtocolDefinition } from '../../../../src/lore/protocol-definition.js';
import type { CommitInput } from '../../../../src/engine/types/commit.js';
import type { Config } from '../../../../src/engine/types/config.js';
import type { Trailers } from '../../../../src/engine/types/domain.js';
import { LORE_DEFAULT_CONFIG } from '../../../../src/lore/defaults.js';

const LORE_ID_KEY = "Lore-id";


// Mock TrailerParser
function createMockTrailerParser() {
  return {
    parse: vi.fn(),
    serialize: vi.fn((trailers: Record<string, string[]>) => {
      const lines: string[] = [];
      // Mock serialization logic that matches test expectations
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
  let config: Config;
  let protocol: Protocol;
  let protocolRegistry: ProtocolRegistry;

  beforeEach(() => {
    mockParser = createMockTrailerParser();
    mockIdGen = createMockIdGenerator();
    config = { ...LORE_DEFAULT_CONFIG };
    protocolRegistry = new ProtocolRegistry();
    protocol = new Protocol(LoreProtocolDefinition, config);
    protocolRegistry.register(protocol);
    
    builder = new CommitBuilder(
      mockParser as any,
      mockIdGen as any,
      config,
      protocolRegistry,
    );
  });

  describe('build', () => {
    it(`should build a minimal commit with intent and ${LORE_ID_KEY}`, () => {
      const input: CommitInput = {
        intent: 'feat(auth): add login flow',
        trailers: {}
      };

      const { message, ids } = builder.build(input);

      expect(mockIdGen.generate).toHaveBeenCalledOnce();
      expect(mockParser.serialize).toHaveBeenCalledOnce();
      expect(message).toContain('feat(auth): add login flow');
      expect(message).toContain(`${LORE_ID_KEY}: a1b2c3d4`);
      expect(ids.lore).toBe('a1b2c3d4');
    });

    it('should include body separated by blank lines', () => {
      const input: CommitInput = {
        intent: 'feat: add feature',
        body: 'This is a detailed explanation.',
        trailers: {}
      };

      const { message } = builder.build(input);

      expect(message).toContain('feat: add feature');
      expect(message).toContain('\n\nThis is a detailed explanation.\n\n');
    });

    it('should include all trailer types', () => {
      const input: CommitInput = {
        intent: 'feat: full commit',
        trailers: {
          Constraint: ['Must use HTTPS', 'No external deps'],
          Rejected: ['Polling approach'],
          Confidence: ['high'],
          'Scope-risk': ['narrow'],
          Reversibility: ['clean'],
          Directive: ['Review in 3 months'],
          Tested: ['Unit tests for auth module'],
          'Not-tested': ['Edge case with expired tokens'],
          Supersedes: ['bbccddee'],
          'Depends-on': ['11223344'],
          Related: ['aabbccdd'],
        },
      };

      const { message } = builder.build(input);

      expect(message).toContain('Constraint: Must use HTTPS');
      expect(message).toContain('Constraint: No external deps');
      expect(message).toContain('Rejected: Polling approach');
      expect(message).toContain('Confidence: high');
      expect(message).toContain('Scope-risk: narrow');
      expect(message).toContain('Reversibility: clean');
      expect(message).toContain('Directive: Review in 3 months');
      expect(message).toContain('Tested: Unit tests for auth module');
      expect(message).toContain('Not-tested: Edge case with expired tokens');
      expect(message).toContain('Supersedes: bbccddee');
      expect(message).toContain('Depends-on: 11223344');
      expect(message).toContain('Related: aabbccdd');
    });

    it(`should auto-generate ${LORE_ID_KEY}`, () => {
      mockIdGen.generate.mockReturnValue('deadbeef');
      const input: CommitInput = { intent: 'test', trailers: {} };

      const { message, ids } = builder.build(input);

      expect(message).toContain(`${LORE_ID_KEY}: deadbeef`);
      expect(ids.lore).toBe('deadbeef');
    });

    it('should use provided existingId instead of generating one', () => {
      const input: CommitInput = { intent: 'amend: update commit', trailers: {} };

      const { message, ids } = builder.build(input, { lore: 'cafebabe' });

      expect(message).toContain(`${LORE_ID_KEY}: cafebabe`);
      expect(ids.lore).toBe('cafebabe');
      expect(mockIdGen.generate).not.toHaveBeenCalled();
    });

    it(`should generate new ${LORE_ID_KEY} when no existingId is provided`, () => {
      const input: CommitInput = { intent: 'new commit', trailers: {} };

      const { ids } = builder.build(input);

      expect(mockIdGen.generate).toHaveBeenCalledOnce();
      expect(ids.lore).toBe('a1b2c3d4');
    });

    it('should pass correct trailers to serialize', () => {
      const input: CommitInput = {
        intent: 'test',
        trailers: { Confidence: ['medium'] },
      };

      builder.build(input);

      const passedTrailers = mockParser.serialize.mock.calls[0][0] as Record<string, string[]>;
      expect(passedTrailers[LORE_ID_KEY]).toEqual(['a1b2c3d4']);
      expect(passedTrailers.Confidence).toEqual(['medium']);
    });

    it('should pass custom trailers through to Trailers as arrays', () => {
      const input: CommitInput = {
        intent: 'feat: with custom trailers',
        trailers: {
          Confidence: ['high'],
          'Assisted-by': ['Gemini:CLI'],
          'Ticket': ['PROJ-123'],
        },
      };

      builder.build(input);

      const passedTrailers = vi.mocked(mockParser.serialize).mock.calls[0][0] as Record<string, string[]>;
      // For Lore (no namespace), it uses the key directly.
      // But we need to make sure the protocol is permissive or has these trailers authorized.
      expect(passedTrailers['Assisted-by']).toEqual(['Gemini:CLI']);
      expect(passedTrailers['Ticket']).toEqual(['PROJ-123']);
    });

    it('should produce empty object when no custom trailers provided', () => {
      const input: CommitInput = {
        intent: 'feat: no custom',
        trailers: { Confidence: ['high'] },
      };

      builder.build(input);

      const passedTrailers = vi.mocked(mockParser.serialize).mock.calls[0][0] as Record<string, string[]>;
      expect(passedTrailers['Assisted-by']).toBeUndefined();
    });
  });

  describe('validate', () => {
    it('should return no issues for valid input', () => {
      const input: CommitInput = {
        intent: 'feat: valid commit message',
        trailers: {
          Confidence: ['medium'],
        },
      };

      const issues = builder.validate(input);
      expect(issues).toEqual([]);
    });

    it('should warn when intent exceeds max length', () => {
      const input: CommitInput = {
        intent: 'a'.repeat(100),
        trailers: {}
      };

      const issues = builder.validate(input);
      const intentIssue = issues.find((i) => i.rule === 'intent-length');
      expect(intentIssue).toBeDefined();
      expect(intentIssue!.severity).toBe('warning');
      expect(intentIssue!.message).toContain('72');
    });

    it('should error when intent is empty', () => {
      const input: CommitInput = {
        intent: '   ',
        trailers: {}
      };

      const issues = builder.validate(input);
      const intentIssue = issues.find((i) => i.rule === 'intent-required');
      expect(intentIssue).toBeDefined();
      expect(intentIssue!.severity).toBe('error');
    });

    it('should error on invalid Confidence enum', () => {
      const input: CommitInput = {
        intent: 'test',
        trailers: { Confidence: ['super-high'] as any },
      };

      const issues = builder.validate(input);
      const enumIssue = issues.find(
        (i) => i.rule === 'invalid-enum' && i.message.includes('Confidence'),
      );
      expect(enumIssue).toBeDefined();
      expect(enumIssue!.severity).toBe('error');
    });

    it('should error on invalid Scope-risk enum', () => {
      const input: CommitInput = {
        intent: 'test',
        trailers: { 'Scope-risk': ['huge'] as any },
      };

      const issues = builder.validate(input);
      const enumIssue = issues.find(
        (i) => i.rule === 'invalid-enum' && i.message.includes('Scope-risk'),
      );
      expect(enumIssue).toBeDefined();
    });

    it('should error on invalid Reversibility enum', () => {
      const input: CommitInput = {
        intent: 'test',
        trailers: { Reversibility: ['maybe'] as any },
      };

      const issues = builder.validate(input);
      const enumIssue = issues.find(
        (i) => i.rule === 'invalid-enum' && i.message.includes('Reversibility'),
      );
      expect(enumIssue).toBeDefined();
    });

    it('should error on invalid lore-id format in references', () => {
      const input: CommitInput = {
        intent: 'test',
        trailers: {
          Supersedes: ['not-hex!'],
          'Depends-on': ['aabbccdd'],
          Related: ['toolong12'],
        },
      };

      const issues = builder.validate(input);
      const refIssues = issues.filter((i) => i.rule.startsWith('invalid-') && i.rule.endsWith('-id-ref'));
      expect(refIssues).toHaveLength(2); // not-hex! and toolong12
    });

    it('should accept valid 8-char hex references', () => {
      const input: CommitInput = {
        intent: 'test',
        trailers: {
          Supersedes: ['aabbccdd'],
          'Depends-on': ['11223344'],
        },
      };

      const issues = builder.validate(input);
      const refIssues = issues.filter((i) => i.rule.startsWith('invalid-') && i.rule.endsWith('-id-ref'));
      expect(refIssues).toHaveLength(0);
    });

    it('should check required trailers from config', () => {
      const strictConfig: Config = {
        ...LORE_DEFAULT_CONFIG,
        trailers: { 
          required: ['Confidence', 'Constraint'], 
          custom: [], 
          definitions: {}, 
          permissive: true 
        },
        validation: { ...LORE_DEFAULT_CONFIG.validation, strict: false },
      };
      
      const strictRegistry = new ProtocolRegistry();
      const p = new Protocol(LoreProtocolDefinition, strictConfig);
      strictRegistry.register(p);

      const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, strictConfig, strictRegistry);

      const input: CommitInput = {
        intent: 'test',
        trailers: {}
      };

      const issues = strictBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues).toHaveLength(2);
      expect(requiredIssues[0].severity).toBe('warning');
    });

    it('should error on missing required trailers in strict mode', () => {
      const strictConfig: Config = {
        ...LORE_DEFAULT_CONFIG,
        trailers: { 
          required: ['Confidence'], 
          custom: [], 
          definitions: {}, 
          permissive: true 
        },
        validation: { ...LORE_DEFAULT_CONFIG.validation, strict: true },
      };
      const strictRegistry = new ProtocolRegistry();
      const p = new Protocol(LoreProtocolDefinition, strictConfig);
      strictRegistry.register(p);

      const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, strictConfig, strictRegistry);

      const input: CommitInput = {
        intent: 'test',
        trailers: {}
      };

      const issues = strictBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues[0].severity).toBe('error');
    });

    it('should warn when message exceeds max lines', () => {
      const longBody = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join('\n');
      const input: CommitInput = {
        intent: 'test',
        body: longBody,
        trailers: {}
      };

      const issues = builder.validate(input);
      const lineIssue = issues.find((i) => i.rule === 'message-length');
      expect(lineIssue).toBeDefined();
      expect(lineIssue!.severity).toBe('warning');
    });

    it('should not warn when message is within line limit', () => {
      const input: CommitInput = {
        intent: 'test',
        body: 'Short body.',
        trailers: {}
      };

      const issues = builder.validate(input);
      const lineIssue = issues.find((i) => i.rule === 'message-length');
      expect(lineIssue).toBeUndefined();
    });

    it('should pass with valid required trailer present', () => {
      const strictConfig: Config = {
        ...LORE_DEFAULT_CONFIG,
        trailers: { 
          required: ['Confidence'], 
          custom: [], 
          definitions: {}, 
          permissive: true 
        },
      };
      const strictRegistry = new ProtocolRegistry();
      const p = new Protocol(LoreProtocolDefinition, strictConfig);
      strictRegistry.register(p);

      const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, strictConfig, strictRegistry);

      const input: CommitInput = {
        intent: 'test',
        trailers: { Confidence: ['medium'] },
      };

      const issues = strictBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues).toHaveLength(0);
    });

    it('should report missing required custom trailer', () => {
      const strictConfig: Config = {
        ...LORE_DEFAULT_CONFIG,
        trailers: { 
          required: ['Assisted-by'], 
          custom: ['Assisted-by'], 
          definitions: {}, 
          permissive: true 
        },
        validation: { ...LORE_DEFAULT_CONFIG.validation, strict: true },
      };
      const strictRegistry = new ProtocolRegistry();
      const p = new Protocol(LoreProtocolDefinition, strictConfig);
      strictRegistry.register(p);

      const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, strictConfig, strictRegistry);

      const input: CommitInput = {
        intent: 'test',
        trailers: { Confidence: ['high'] },
      };

      const issues = strictBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues).toHaveLength(1);
      expect(requiredIssues[0].message).toContain('Assisted-by');
      expect(requiredIssues[0].severity).toBe('error');
    });

    it('should not report missing required trailer when custom trailer is present', () => {
      const strictConfig: Config = {
        ...LORE_DEFAULT_CONFIG,
        trailers: { 
          required: ['Assisted-by'], 
          custom: ['Assisted-by'], 
          definitions: {}, 
          permissive: true 
        },
        validation: { ...LORE_DEFAULT_CONFIG.validation, strict: true },
      };
      const strictRegistry = new ProtocolRegistry();
      const p = new Protocol(LoreProtocolDefinition, strictConfig);
      strictRegistry.register(p);

      const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, strictConfig, strictRegistry);

      const input: CommitInput = {
        intent: 'test',
        trailers: {
          Confidence: ['high'],
          'Assisted-by': ['Gemini:CLI'],
        },
      };

      const issues = strictBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues).toHaveLength(0);
    });

    it('should rebrand reference format errors for namespaced protocols', () => {
      // 1. Setup Fred protocol with namespace "Fred"
      const fredDef: any = {
        name: 'Fred',
        version: '1.0',
        namespace: 'fred',
        identityKey: 'Fred-id',
        trailers: {
          'Fred-id': { multivalue: false, validation: 'pattern', pattern: '^[0-9a-f]{8}$' },
          'Depends-on': { multivalue: true, validation: 'pattern', pattern: '^[0-9a-f]{8}$', ui: { kind: 'reference' } },
        }
      };
      
      const fredRegistry = new ProtocolRegistry();
      const fredProtocol = new Protocol(fredDef, LORE_DEFAULT_CONFIG);
      fredRegistry.register(fredProtocol);

      const fredBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, LORE_DEFAULT_CONFIG, fredRegistry);

      const input = {
        intent: 'feat',
        trailers: { 'fred/Depends-on': ['invalid-id'] }
      };

      const issues = fredBuilder.validate(input);
      const issue = issues.find(i => i.rule === 'invalid-fred-id-ref');

      expect(issue).toBeDefined();
      expect(issue?.message).toContain('Value for "Depends-on" does not match pattern');
    });
  });
});
