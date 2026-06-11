import { beforeEach,describe, expect, it } from 'vitest';

import { finalizeCommitInput, InputMode, parseFlagsToInput, selectInputMode } from '../../../../src/engine/core/logic/input-interpretation.js';
import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import type { ProtocolContext } from '../../../../src/engine/core/types/protocol-definition.js';
import { 
    makeStubProtocolContext,
    MOCK_CORE_TRAILERS, 
    TEST_PROTOCOL_DEFINITION} from '../../../../src/engine/testing.js';

describe('Input Interpretation Logic (Pure Functions)', () => {
  let protocols: ProtocolMap<ProtocolContext>;
  let mockProtocol: ProtocolContext;

  beforeEach(() => {
    mockProtocol = makeStubProtocolContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
    });
    protocols = new ProtocolMap<ProtocolContext>();
    protocols.set(mockProtocol.name, mockProtocol);
  });

  describe('selectInputMode', () => {
    it('should prioritize interactive flag', () => {
      const mode = selectInputMode({ interactive: true, file: 'test.json', subject: 'test' });
      expect(mode).toBe(InputMode.Interactive);
    });

    it('should prioritize file flag over other options', () => {
      const mode = selectInputMode({ file: 'test.json', subject: 'test' });
      expect(mode).toBe(InputMode.File);
    });

    it('should select flags mode if any intent-related flag is present', () => {
      const mode = selectInputMode({ subject: 'test' });
      expect(mode).toBe(InputMode.Flags);
    });

    it('should fallback to stdin for empty options (non-interactive default)', () => {
        const mode = selectInputMode({});
        expect(mode).toBe(InputMode.Stdin);
    });

    it('should NOT trigger flags mode for whitelisted background flags (like updateNotifier)', () => {
        const mode = selectInputMode({ updateNotifier: false });
        expect(mode).toBe(InputMode.Stdin);
    });

    it('should select Flags mode when subject is provided', () => {
      expect(selectInputMode({ subject: 'feat: text' })).toBe(InputMode.Flags);
    });

    it('should select Stdin mode by default', () => {
      expect(selectInputMode({})).toBe(InputMode.Stdin);
    });
  });

  describe('parseFlagsToInput', () => {
    it('should map all explicit CLI trailer options correctly', () => {
        const options = {
          subject: 'feat: add auth',
          body: 'Detailed description',
          trailer: ['Constraint=must be fast', 'Constraint=no breaking changes', 'Confidence=high', 'Related=id3']
        };
    
        const result = parseFlagsToInput(options, protocols);
    
        expect(result.subject).toBe('feat: add auth');
        expect(result.body).toBe('Detailed description');
        const mockGroup = result.trailers?.get('mock') || {};
        expect(mockGroup.Constraint).toEqual(['must be fast', 'no breaking changes']);
        expect(mockGroup.Confidence).toEqual(['high']);
        expect(mockGroup.Related).toEqual(['id3']);
    });

    it('should support explicit catch-all --trailer flags', () => {
        const input = parseFlagsToInput({ 
            trailer: ['Confidence=medium', 'Constraint=rule1']
        }, protocols);

        expect(input.trailers?.get('mock')?.['Confidence']).toEqual(['medium']);
        expect(input.trailers?.get('mock')?.['Constraint']).toEqual(['rule1']);
    });

    it('should support multiple values for a single key in catch-all flag', () => {
        const input = parseFlagsToInput({ 
            trailer: ['Constraint=c1', 'Constraint=c2']
        }, protocols);

        expect(input.trailers?.get('mock')?.['Constraint']).toEqual(['c1', 'c2']);
    });

    it('should support qualified trailers (Protocol/Key=Value)', () => {
        const p1 = makeStubProtocolContext({ 
            name: 'P1', 
            namespace: 'p1', 
            trailers: { Status: { description: 'S', multivalue: false, validation: 'none' as const } } 
        });
        const p2 = makeStubProtocolContext({ 
            name: 'P2', 
            namespace: 'p2', 
            trailers: { Status: { description: 'S', multivalue: false, validation: 'none' as const } } 
        });
        const localProtocols = new ProtocolMap<ProtocolContext>();
        localProtocols.set(p1.name, p1);
        localProtocols.set(p2.name, p2);
        
        const options = {
            trailer: ['P1/Status=active', 'P2/Status=pending']
        };
    
        const result = parseFlagsToInput(options, localProtocols);
    
        expect(result.trailers?.get('p1')!.Status).toEqual(['active']);
        expect(result.trailers?.get('p2')!.Status).toEqual(['pending']);
    });

    it('should default unqualified trailers to the root protocol if it is the only owner', () => {
        const p1 = makeStubProtocolContext({ 
            name: 'Root', 
            namespace: '', 
            trailers: { Status: { description: 'S', multivalue: false, validation: 'none' as const } } 
        });
        const p2 = makeStubProtocolContext({ 
            name: 'NS', 
            namespace: 'ns', 
            trailers: { Other: { description: 'O', multivalue: false, validation: 'none' as const } } 
        });
        const localProtocols = new ProtocolMap<ProtocolContext>();
        localProtocols.set(p1.name, p1);
        localProtocols.set(p2.name, p2);
        
        const options = {
            trailer: ['Status=active']
        };
    
        const result = parseFlagsToInput(options, localProtocols);
        expect(result.trailers?.get('root')!.Status).toEqual(['active']);
    });

    it('should default subject to empty string when undefined', () => {
        const result = parseFlagsToInput({}, protocols);
        expect(result.subject).toBe('');
    });

    describe('Logic Parity', () => {
        it('should leave body undefined when not provided', () => {
            const input = parseFlagsToInput({ subject: 's' }, protocols);
            expect(input.body).toBeUndefined();
        });
    });

    it('should map trailers from catch-all --trailer flag', () => {

      const permissiveProtocol = makeStubProtocolContext({
          ...TEST_PROTOCOL_DEFINITION,
          permissive: true,
          trailers: {
              ...TEST_PROTOCOL_DEFINITION.trailers,
              'Status': { description: 'S', multivalue: false, validation: 'none' as const }
          }
      });
      const localProtocols = new ProtocolMap<ProtocolContext>();
      localProtocols.set(permissiveProtocol.name, permissiveProtocol);

      const input = parseFlagsToInput({ trailer: ['mock/Status=active'] }, localProtocols);
      expect(input.trailers?.get('mock')?.Status).toEqual(['active']);
    });
  });

  describe('finalizeCommitInput', () => {
    it('should apply defaults and ensure non-null fields', () => {
      const input = finalizeCommitInput({ subject: 'test' });
      expect(input.subject).toBe('test');
      expect(input.body).toBe('');
      expect(input.trailers).toBeDefined();
    });
  });
});