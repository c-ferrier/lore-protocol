import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommitBuilder } from '../../../../src/engine/services/commit-builder.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { MOCK_PROTOCOL_DEFINITION, MOCK_CONFIG } from '../test-utils.js';
import type { CommitInput } from '../../../../src/engine/types/commit.js';
import type { EngineConfig, ProtocolConfig } from '../../../../src/engine/types/config.js';

const MOCK_ID_KEY = "Mock-id";

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
  let engineConfig: EngineConfig;
  let pConfig: ProtocolConfig;
  let protocol: Protocol;
  let protocolRegistry: ProtocolRegistry;

  beforeEach(() => {
    mockParser = createMockTrailerParser();
    mockIdGen = createMockIdGenerator();
    engineConfig = { ...MOCK_CONFIG };
    pConfig = { 
        version: '1.0', 
        trailers: { required: [], custom: [], definitions: {}, permissive: true } 
    };
    protocolRegistry = new ProtocolRegistry();
    protocol = new Protocol(MOCK_PROTOCOL_DEFINITION, pConfig);
    protocolRegistry.register(protocol);
    
    builder = new CommitBuilder(
      mockParser as any,
      mockIdGen as any,
      engineConfig,
      protocolRegistry,
    );
  });

  describe('build', () => {
    it(`should build a minimal commit with subject and ${MOCK_ID_KEY}`, () => {
      const input: CommitInput = {
        subject: 'feat(auth): add login flow',
        trailers: {}
      };

      const { message, protocols } = builder.build(input);

      expect(mockIdGen.generate).toHaveBeenCalledOnce();
      expect(mockParser.serialize).toHaveBeenCalledOnce();
      expect(message).toContain('feat(auth): add login flow');
      expect(message).toContain(`${MOCK_ID_KEY}: a1b2c3d4`);
      expect(protocols.mock.id).toBe('a1b2c3d4');
      expect(protocols.mock.version).toBe('1.0');
    });

    it('should include body separated by blank lines', () => {
      const input: CommitInput = {
        subject: 'feat: add feature',
        body: 'This is a detailed explanation.',
        trailers: {}
      };

      const { message } = builder.build(input);

      expect(message).toContain('feat: add feature');
      expect(message).toContain('\n\nThis is a detailed explanation.\n\n');
    });

    it('should include all trailer types', () => {
      const input: CommitInput = {
        subject: 'feat: full commit',
        trailers: {
          Constraint: ['Must use HTTPS', 'No external deps'],
          Confidence: ['high'],
          Related: ['aabbccdd'],
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
      const input: CommitInput = { subject: 'test', trailers: {} };

      const { message, protocols } = builder.build(input);

      expect(message).toContain(`${MOCK_ID_KEY}: deadbeef`);
      expect(protocols.mock.id).toBe('deadbeef');
    });

    it('should use provided existingId instead of generating one', () => {
      const input: CommitInput = { subject: 'amend: update commit', trailers: {} };

      const { message, protocols } = builder.build(input, { mock: 'cafebabe' });

      expect(message).toContain(`${MOCK_ID_KEY}: cafebabe`);
      expect(protocols.mock.id).toBe('cafebabe');
      expect(mockIdGen.generate).not.toHaveBeenCalled();
    });

    it(`should generate new ${MOCK_ID_KEY} when no existingId is provided`, () => {
      const input: CommitInput = { subject: 'new commit', trailers: {} };

      const { protocols } = builder.build(input);

      expect(mockIdGen.generate).toHaveBeenCalledOnce();
      expect(protocols.mock.id).toBe('a1b2c3d4');
    });

    it('should pass correct trailers to serialize', () => {
      const input: CommitInput = {
        subject: 'test',
        trailers: { Confidence: ['medium'] },
      };

      builder.build(input);

      const passedTrailers = mockParser.serialize.mock.calls[0][0] as Record<string, string[]>;
      expect(passedTrailers[MOCK_ID_KEY]).toEqual(['a1b2c3d4']);
      expect(passedTrailers.Confidence).toEqual(['medium']);
    });

    it('should correctly resolve trailer ownership between explicit and permissive protocols', () => {
      // 1. Setup Fred protocol (Strict, namespaced)
      const fredDef: any = {
        name: 'Fred',
        version: '1.0',
        namespace: 'fred',
        identityKey: 'Fred-id',
        trailers: {
          'Fred-id': { description: 'ID' },
          'Fred-Level': { description: 'Level' },
        }
      };
      const fredProtocol = new Protocol(fredDef, MOCK_CONFIG);
      protocolRegistry.register(fredProtocol);

      // 2. Setup Input with mixed trailers
      const input: CommitInput = {
        subject: 'feat: mixed trailers',
        trailers: {
          'fred/Fred-Level': ['high'], // Explicitly namespaced for Fred
          'Confidence': ['medium'],    // Root orphan, should be claimed by Mock
          'Unknown-key': ['val'],      // Root orphan, should be claimed by Mock
        }
      };

      const { message, protocols } = builder.build(input, { mock: 'l1', fred: 'f1' });

      // 3. Verify Message (Serialized by mock parser)
      expect(message).toContain('fred/Fred-id: f1'); // Identity MUST be namespaced
      expect(message).toContain('fred/Fred-Level: high');
      expect(message).toContain('Mock-id: l1');
      expect(message).toContain('Confidence: medium');
      expect(message).toContain('Unknown-key: val');

      // 4. Verify Protocol State (Internal build results)
      expect(protocols.fred.id).toBe('f1');
      expect(protocols.mock.id).toBe('l1');
    });
  });

  describe('validate', () => {
    it('should return no issues for valid input', () => {
      const input: CommitInput = {
        subject: 'feat: valid commit message',
        trailers: {
          Confidence: ['medium'],
        },
      };

      const issues = builder.validate(input);
      expect(issues).toEqual([]);
    });

    it('should warn when subject exceeds max length', () => {
      const input: CommitInput = {
        subject: 'a'.repeat(100),
        trailers: {}
      };

      const issues = builder.validate(input);
      const subjectIssue = issues.find((i) => i.rule === 'subject-length');
      expect(subjectIssue).toBeDefined();
      expect(subjectIssue!.severity).toBe('warning');
      expect(subjectIssue!.message).toContain('72');
    });

    it('should error when subject is empty', () => {
      const input: CommitInput = {
        subject: '   ',
        trailers: {}
      };

      const issues = builder.validate(input);
      const subjectIssue = issues.find((i) => i.rule === 'subject-required');
      expect(subjectIssue).toBeDefined();
      expect(subjectIssue!.severity).toBe('error');
    });

    it('should error on invalid Confidence enum', () => {
      const input: CommitInput = {
        subject: 'test',
        trailers: { Confidence: ['super-high'] as any },
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
          Related: ['not-hex!'],
        },
      };

      const issues = builder.validate(input);
      const refIssues = issues.filter((i) => i.rule.startsWith('invalid-') && i.rule.endsWith('-id-ref'));
      expect(refIssues).toHaveLength(1);
    });

    it('should accept valid 8-char hex references', () => {
      const input: CommitInput = {
        subject: 'test',
        trailers: {
          Related: ['aabbccdd'],
        },
      };

      const issues = builder.validate(input);
      const refIssues = issues.filter((i) => i.rule.startsWith('invalid-') && i.rule.endsWith('-id-ref'));
      expect(refIssues).toHaveLength(0);
    });

    it('should check required trailers from protocol config', () => {
      const requiredPConfig: ProtocolConfig = {
        version: '1.0',
        trailers: { 
          required: ['Confidence', 'Constraint'], 
          custom: [], 
          definitions: {}, 
          permissive: true 
        },
      };
      
      const requiredRegistry = new ProtocolRegistry();
      const p = new Protocol(MOCK_PROTOCOL_DEFINITION, requiredPConfig);
      requiredRegistry.register(p);

      const requiredBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, engineConfig, requiredRegistry);

      const input: CommitInput = {
        subject: 'test',
        trailers: {}
      };

      const issues = requiredBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues).toHaveLength(2);
      expect(requiredIssues[0].severity).toBe('warning');
    });

    it('should error on missing required trailers in strict mode', () => {
      const strictEngineConfig: EngineConfig = {
        ...MOCK_CONFIG,
        validation: { ...MOCK_CONFIG.validation, strict: true },
      };
      const requiredPConfig: ProtocolConfig = {
        version: '1.0',
        trailers: { 
          required: ['Confidence'], 
          custom: [], 
          definitions: {}, 
          permissive: true 
        },
      };
      const strictRegistry = new ProtocolRegistry();
      const p = new Protocol(MOCK_PROTOCOL_DEFINITION, requiredPConfig);
      strictRegistry.register(p);

      const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, strictEngineConfig, strictRegistry);

      const input: CommitInput = {
        subject: 'test',
        trailers: {}
      };

      const issues = strictBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues[0].severity).toBe('error');
    });

    it('should warn when message exceeds max lines', () => {
      const longBody = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join('\n');
      const input: CommitInput = {
        subject: 'test',
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
        subject: 'test',
        body: 'Short body.',
        trailers: {}
      };

      const issues = builder.validate(input);
      const lineIssue = issues.find((i) => i.rule === 'message-length');
      expect(lineIssue).toBeUndefined();
    });

    it('should pass with valid required trailer present', () => {
      const requiredPConfig: ProtocolConfig = {
        version: '1.0',
        trailers: { 
          required: ['Confidence'], 
          custom: [], 
          definitions: {}, 
          permissive: true 
        },
      };
      const strictRegistry = new ProtocolRegistry();
      const p = new Protocol(MOCK_PROTOCOL_DEFINITION, requiredPConfig);
      strictRegistry.register(p);

      const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, engineConfig, strictRegistry);

      const input: CommitInput = {
        subject: 'test',
        trailers: { Confidence: ['medium'] },
      };

      const issues = strictBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues).toHaveLength(0);
    });

    it('should report missing required custom trailer', () => {
      const strictEngineConfig: EngineConfig = {
        ...MOCK_CONFIG,
        validation: { ...MOCK_CONFIG.validation, strict: true },
      };
      const customPConfig: ProtocolConfig = {
        version: '1.0',
        trailers: { 
          required: ['Assisted-by'], 
          custom: ['Assisted-by'], 
          definitions: {}, 
          permissive: true 
        },
      };
      const strictRegistry = new ProtocolRegistry();
      const p = new Protocol(MOCK_PROTOCOL_DEFINITION, customPConfig);
      strictRegistry.register(p);

      const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, strictEngineConfig, strictRegistry);

      const input: CommitInput = {
        subject: 'test',
        trailers: { Confidence: ['high'] },
      };

      const issues = strictBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues).toHaveLength(1);
      expect(requiredIssues[0].message).toContain('Assisted-by');
      expect(requiredIssues[0].severity).toBe('error');
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
      const fredProtocol = new Protocol(fredDef, MOCK_CONFIG);
      fredRegistry.register(fredProtocol);

      const fredBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, MOCK_CONFIG, fredRegistry);

      const input = {
        subject: 'feat',
        trailers: { 'fred/Depends-on': ['invalid-id'] }
      };

      const issues = fredBuilder.validate(input);
      const issue = issues.find(i => i.rule === 'invalid-fred-id-ref');

      expect(issue).toBeDefined();
      expect(issue?.message).toContain('Value for "Depends-on" does not match pattern');
    });
  });
});
