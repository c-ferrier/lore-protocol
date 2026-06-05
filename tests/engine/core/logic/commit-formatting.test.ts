import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest';

import { formatCommit, validateFormatting } from '../../../../src/engine/core/logic/commit-formatting.js';
import { type EngineConfig } from '../../../../src/engine/core/types/config.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { 
  makeCommitInput, 
  makeMockContext, 
  MOCK_CORE_TRAILERS,
  TEST_ENGINE_CONFIG, 
  TEST_PROTOCOL_DEFINITION} from '../../../../src/engine/testing.js';
;
;

;

import * as IdentityLogic from '../../../../src/engine/core/logic/identity.js';
import * as TrailerLogic from '../../../../src/engine/core/logic/trailers.js';

const TEST_ID_KEY = "Mock-id";

describe('Commit Formatting Logic (Pure Functions)', () => {
  let engineConfig: EngineConfig;
  let protocolRegistry: ProtocolRegistry;
  let idSpy: any;

  beforeEach(() => {
    engineConfig = { ...TEST_ENGINE_CONFIG };

    protocolRegistry = new ProtocolRegistry();
    // Register protocol with core trailers to satisfy tests expecting Confidence/Constraint
    protocolRegistry.register(makeMockContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
    }));
    
    // Default deterministic ID for tests
    idSpy = vi.spyOn(IdentityLogic, 'generateId').mockReturnValue('a1b2c3d4');
  });

  afterEach(() => {
    idSpy.mockRestore();
  });

  describe('formatCommit', () => {
    it(`should build a minimal commit with subject and ${TEST_ID_KEY}`, () => {
      const input = makeCommitInput({
        subject: 'feat: add login',
        trailers: { 'mock': { [TEST_ID_KEY]: ['a1b2c3d4'] } },
      });

      const { message, protocols } = formatCommit(input, engineConfig, protocolRegistry);

      expect(message).toContain('feat: add login');
      expect(message).toContain(`${TEST_ID_KEY}: a1b2c3d4`);
      expect(protocols.mock.id).toBe('a1b2c3d4');
    });

    it('should pass correct trailers to serialize', () => {
      const spy = vi.spyOn(TrailerLogic, 'serializeTrailers');
      const input = makeCommitInput({
        subject: 'test',
        trailers: { 'mock': { Confidence: ['medium'] } },
      });

      formatCommit(input, engineConfig, protocolRegistry);

      const passedTrailers = spy.mock.calls[0][0] as Record<string, string[]>;
      expect(passedTrailers[TEST_ID_KEY]).toEqual(['a1b2c3d4']);
      expect(passedTrailers.Confidence).toEqual(['medium']);
      spy.mockRestore();
    });

    it('should include body separated by blank lines', () => {
      const input = makeCommitInput({
        subject: 'feat: add login',
        body: 'Detailed description of changes.',
        trailers: { 'mock': { [TEST_ID_KEY]: ['a1b2c3d4'] } },
      });

      const { message } = formatCommit(input, engineConfig, protocolRegistry);

      expect(message).toBe(`feat: add login\n\nDetailed description of changes.\n\n${TEST_ID_KEY}: a1b2c3d4`);
    });

    it('should format subject-only commit correctly', () => {
        const input = makeCommitInput({
          subject: 'feat: minimal',
          trailers: { 'mock': { [TEST_ID_KEY]: ['a1b2c3d4'] } },
        });
  
        const { message } = formatCommit(input, engineConfig, protocolRegistry);
  
        expect(message).toBe(`feat: minimal\n\n${TEST_ID_KEY}: a1b2c3d4`);
    });

    it('should handle empty body string correctly (same as subject-only)', () => {
        const input = makeCommitInput({
          subject: 'feat: minimal',
          body: '',
          trailers: { 'mock': { [TEST_ID_KEY]: ['a1b2c3d4'] } },
        });
  
        const { message } = formatCommit(input, engineConfig, protocolRegistry);
  
        expect(message).toBe(`feat: minimal\n\n${TEST_ID_KEY}: a1b2c3d4`);
    });

    it('should include all trailer types', () => {
      const input = makeCommitInput({
        subject: 'feat: full commit',
        trailers: {
          'mock': {
            Constraint: ['Must use HTTPS', 'No external deps'],
            Confidence: ['high'],
            Related: ['aabbccdd'],
          }
        },
      });

      const { message } = formatCommit(input, engineConfig, protocolRegistry);

      expect(message).toContain('Constraint: Must use HTTPS');
      expect(message).toContain('Constraint: No external deps');
      expect(message).toContain('Confidence: high');
      expect(message).toContain('Related: aabbccdd');
    });

    it('should reuse existing IDs if provided (e.g. for amend)', () => {
        const input = makeCommitInput({ subject: 'amend' });
        const existingIds = { 'mock': 'old-id-123' };
        
        const { protocols } = formatCommit(input, engineConfig, protocolRegistry, existingIds);
        expect(protocols.mock.id).toBe('old-id-123');
        expect(idSpy).not.toHaveBeenCalled();
    });
  });

  describe('validateFormatting', () => {
    it('should return empty issues for valid input', async () => {
      const input = makeCommitInput({
        subject: 'feat: valid',
        trailers: { 'mock': { Confidence: ['high'] } }
      });

      const issues = await validateFormatting(input, engineConfig, protocolRegistry);
      expect(issues).toHaveLength(0);
    });

    it('should return warnings for long messages', async () => {
        const config = { 
            ...engineConfig, 
            validation: { ...engineConfig.validation, maxMessageLines: 2 } 
        };
        const input = makeCommitInput({
            subject: 'test',
            body: 'Line 1\nLine 2\nLine 3'
        });

        const issues = await validateFormatting(input, config, protocolRegistry);
        expect(issues.some(i => i.rule === 'message-length')).toBe(true);
    });

    it('should NOT report missing identity key if it has a generator', async () => {
        const genProtocol = makeMockContext({
            name: 'Gen',
            identityKey: 'Gen-id',
            trailers: {
                'Gen-id': { description: 'ID', generator: 'uuid' } as any
            }
        });
        const registry = new ProtocolRegistry();
        registry.register(genProtocol);

        const input = makeCommitInput({ subject: 'test', trailers: {} });
        const issues = await validateFormatting(input, engineConfig, registry);
        
        // gen-id-present should be filtered out
        expect(issues.some(i => i.rule === 'gen-id-present')).toBe(false);
    });
  });

  describe('Namespacing & Multiple Protocols', () => {
    it('should correctly namespace trailers for multiple protocols', () => {
        const registry = new ProtocolRegistry();
        registry.register(makeMockContext({ name: 'Alpha', namespace: 'alpha', identityKey: 'Alpha-id' }));
        registry.register(makeMockContext({ name: 'Beta', namespace: 'beta', identityKey: 'Beta-id' }));

        const input = makeCommitInput({
            subject: 'multi-protocol',
            trailers: {
                'alpha': { 'Status': ['active'] },
                'beta': { 'Priority': ['high'] }
            }
        });

        idSpy.mockReturnValue('new-id');
        const { message } = formatCommit(input, engineConfig, registry);

        expect(message).toContain('alpha: Alpha-id: new-id');
        expect(message).toContain('alpha: Status: active');
        expect(message).toContain('beta: Beta-id: new-id');
        expect(message).toContain('beta: Priority: high');
    });

    it('should throw error for unknown protocol in input', () => {
        const input = makeCommitInput({
            trailers: { 'unknown': { 'Key': ['val'] } }
        });

        expect(() => formatCommit(input, engineConfig, protocolRegistry)).toThrow(/Unknown protocol "unknown"/);
    });
  });
});