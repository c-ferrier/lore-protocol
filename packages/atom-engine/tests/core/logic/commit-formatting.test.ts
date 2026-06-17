import { afterEach,beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { formatCommit, validateFormatting } from '../../../src/core/logic/commit-formatting.js';
import * as IdentityLogic from '../../../src/core/logic/identity.js';
import * as TrailerLogic from '../../../src/core/logic/trailers.js';
import { ProtocolMap } from '../../../src/core/models/protocol-map.js';
import { type EngineConfig } from '../../../src/core/types/config.js';
import { 
  makeCommitInput, 
  makeStubProtocolContext, 
  MOCK_CORE_TRAILERS,
  type ProtocolContext,  TEST_ENGINE_CONFIG, 
  TEST_PROTOCOL_DEFINITION} from '../../../src/testing.js';

const TEST_ID_KEY = "Mock-id";

describe('Commit Formatting Logic (Pure Functions)', () => {
  let engineConfig: EngineConfig;
  let protocols: ProtocolMap<ProtocolContext>;
  let idSpy: Mock;

  beforeEach(() => {
    engineConfig = { ...TEST_ENGINE_CONFIG };

    protocols = new ProtocolMap<ProtocolContext>();
    // Register protocol with core trailers to satisfy tests expecting Confidence/Constraint
    const protocol = makeStubProtocolContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
    });
    protocols.set(protocol.name, protocol);
    
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
        trailers: new ProtocolMap<Record<string, string[]>>([['mock', { [TEST_ID_KEY]: ['a1b2c3d4'] }]]),
      });

      const { message, protocols: resultProtocols } = formatCommit(input, engineConfig, protocols);

      expect(message).toContain('feat: add login');
      expect(message).toContain(`${TEST_ID_KEY}: a1b2c3d4`);
      expect(resultProtocols.get('mock')!.trailers[TEST_ID_KEY][0]).toBe('a1b2c3d4');
    });

    it('should pass correct trailers to serialize', () => {
      const spy = vi.spyOn(TrailerLogic, 'serializeTrailers');
      const input = makeCommitInput({
        subject: 'test',
        trailers: new ProtocolMap<Record<string, string[]>>([['mock', { Confidence: ['medium'] }]]),
      });

      formatCommit(input, engineConfig, protocols);

      const passedTrailers = spy.mock.calls[0][0] as Record<string, string[]>;
      expect(passedTrailers[TEST_ID_KEY]).toEqual(['a1b2c3d4']);
      expect(passedTrailers.Confidence).toEqual(['medium']);
      spy.mockRestore();
    });

    it('should include body separated by blank lines', () => {
      const input = makeCommitInput({
        subject: 'feat: add login',
        body: 'Detailed description of changes.',
        trailers: new ProtocolMap<Record<string, string[]>>([['mock', { [TEST_ID_KEY]: ['a1b2c3d4'] }]]),
      });

      const { message } = formatCommit(input, engineConfig, protocols);

      expect(message).toBe(`feat: add login\n\nDetailed description of changes.\n\n${TEST_ID_KEY}: a1b2c3d4`);
    });

    it('should format subject-only commit correctly', () => {
        const input = makeCommitInput({
          subject: 'feat: minimal',
          trailers: new ProtocolMap<Record<string, string[]>>([['mock', { [TEST_ID_KEY]: ['a1b2c3d4'] }]]),
        });
  
        const { message } = formatCommit(input, engineConfig, protocols);
  
        expect(message).toBe(`feat: minimal\n\n${TEST_ID_KEY}: a1b2c3d4`);
    });

    it('should handle empty body string correctly (same as subject-only)', () => {
        const input = makeCommitInput({
          subject: 'feat: minimal',
          body: '',
          trailers: new ProtocolMap<Record<string, string[]>>([['mock', { [TEST_ID_KEY]: ['a1b2c3d4'] }]]),
        });
  
        const { message } = formatCommit(input, engineConfig, protocols);
  
        expect(message).toBe(`feat: minimal\n\n${TEST_ID_KEY}: a1b2c3d4`);
    });

    it('should include all trailer types', () => {
      const input = makeCommitInput({
        subject: 'feat: full commit',
        trailers: new ProtocolMap<Record<string, string[]>>([['mock', {
            Constraint: ['Must use HTTPS', 'No external deps'],
            Confidence: ['high'],
            Related: ['aabbccdd'],
        }]])
      });

      const { message } = formatCommit(input, engineConfig, protocols);

      expect(message).toContain('Constraint: Must use HTTPS');
      expect(message).toContain('Constraint: No external deps');
      expect(message).toContain('Confidence: high');
      expect(message).toContain('Related: aabbccdd');
    });

    it('should reuse existing IDs if provided (e.g. for amend)', () => {
        const input = makeCommitInput({ subject: 'amend' });
        const existingIds = { 'mock': 'old-id-123' };
        
        const { protocols: resultProtocols } = formatCommit(input, engineConfig, protocols, existingIds);
        expect(resultProtocols.get('mock')!.trailers[TEST_ID_KEY][0]).toBe('old-id-123');
        expect(idSpy).not.toHaveBeenCalled();
    });
  });

  describe('validateFormatting', () => {
    it('should return empty issues for valid input', async () => {
      const input = makeCommitInput({
        subject: 'feat: valid',
        trailers: new ProtocolMap<Record<string, string[]>>([['mock', { Confidence: ['high'] }]])
      });

      const issues = validateFormatting(input,
 engineConfig, protocols);
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

        const issues = validateFormatting(input,
 config, protocols);
        expect(issues.some(i => i.rule === 'message-length')).toBe(true);
    });

    it('should NOT report missing identity key if it has a generator', async () => {
        const genProtocol = makeStubProtocolContext({
            name: 'Gen',
            identityKey: 'Gen-id',
            trailers: {
                'Gen-id': { description: 'ID', multivalue: false, validation: 'none', generator: 'uuid' }
            }
        });
        const localProtocols = new ProtocolMap<ProtocolContext>();
        localProtocols.set(genProtocol.name, genProtocol);

        const input = makeCommitInput({ subject: 'test', trailers: new ProtocolMap<Record<string, string[]>>() });
        const issues = validateFormatting(input,
 engineConfig, localProtocols);
        
        // gen-id-present should be filtered out
        expect(issues.some(i => i.rule === 'gen-id-present')).toBe(false);
    });
  });

  describe('Namespacing & Multiple Protocols', () => {
    it('should correctly namespace trailers for multiple protocols', () => {
        const localProtocols = new ProtocolMap<ProtocolContext>();
        localProtocols.set('alpha', makeStubProtocolContext({ name: 'Alpha', namespace: 'alpha', identityKey: 'Alpha-id' }));
        localProtocols.set('beta', makeStubProtocolContext({ name: 'Beta', namespace: 'beta', identityKey: 'Beta-id' }));

        const input = makeCommitInput({
            subject: 'multi-protocol',
            trailers: new ProtocolMap<Record<string, string[]>>([
                ['alpha', { 'Status': ['active'] }],
                ['beta', { 'Priority': ['high'] }]
            ])
        });

        idSpy.mockReturnValue('new-id');
        const { message } = formatCommit(input, engineConfig, localProtocols);

        expect(message).toContain('alpha: Alpha-id: new-id');
        expect(message).toContain('alpha: Status: active');
        expect(message).toContain('beta: Beta-id: new-id');
        expect(message).toContain('beta: Priority: high');
    });

    it('should throw error for unknown protocol in input', () => {
        const input = makeCommitInput({
            trailers: new ProtocolMap<Record<string, string[]>>([['unknown', { 'Key': ['val'] }]])
        });

        expect(() => formatCommit(input, engineConfig, protocols)).toThrow(/Unknown protocol "unknown"/);
    });

    it('should format a commit message with multiple protocols and correct namespaces', () => {
      const p1 = makeStubProtocolContext({ name: 'P1', namespace: 'ns1', identityKey: 'P1-id' });
      const p2 = makeStubProtocolContext({ name: 'P2', namespace: 'ns2', identityKey: 'P2-id' });
      
      const localProtocols = new ProtocolMap<ProtocolContext>();
      localProtocols.set(p1.name, p1);
      localProtocols.set(p2.name, p2);
  
      const input = makeCommitInput({
        subject: 'feat: multi-proto',
        trailers: new ProtocolMap<Record<string, string[]>>([
          ['p1', { 'P1-id': ['id1'] }],
          ['p2', { 'P2-id': ['id2'] }]
        ])
      });
  
      const { message } = formatCommit(input, engineConfig, localProtocols, { p1: 'id1', p2: 'id2' });
      
      expect(message).toContain('ns1: P1-id: id1');
      expect(message).toContain('ns2: P2-id: id2');
    });
  });
});