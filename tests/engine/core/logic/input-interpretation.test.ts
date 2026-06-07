import { beforeEach,describe, expect, it } from 'vitest';

import { finalizeCommitInput, InputMode, parseFlagsToInput, selectInputMode } from '../../../../src/engine/core/logic/input-interpretation.js';
import type { ProtocolContext } from '../../../../src/engine/core/types/protocol-definition.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { 
    makeStubProtocolContext,
    makeStubProtocolRegistry, 
    MOCK_CORE_TRAILERS, 
    TEST_PROTOCOL_DEFINITION} from '../../../../src/engine/testing.js';

describe('Input Interpretation Logic (Pure Functions)', () => {
  let registry: ProtocolRegistry;
  let mockProtocol: ProtocolContext;

  beforeEach(() => {
    mockProtocol = makeStubProtocolContext({
        ...TEST_PROTOCOL_DEFINITION,
        trailers: { ...TEST_PROTOCOL_DEFINITION.trailers, ...MOCK_CORE_TRAILERS }
    });
    registry = new ProtocolRegistry();
    registry.register(mockProtocol);
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
  });

  describe('parseFlagsToInput', () => {
    it('should map all CLI options correctly', () => {
        const options: any = {
          subject: 'feat: add auth',
          body: 'Detailed description',
          constraint: ['must be fast', 'no breaking changes'],
          confidence: 'high',
          related: ['id3'],
        };
    
        const result = parseFlagsToInput(options, registry);
    
        expect(result.subject).toBe('feat: add auth');
        expect(result.body).toBe('Detailed description');
        const mockGroup = result.trailers?.get('mock') || {};
        expect(mockGroup.Constraint).toEqual(['must be fast', 'no breaking changes']);
        expect(mockGroup.Confidence).toEqual(['high']);
        expect(mockGroup.Related).toEqual(['id3']);
    });

    it('should map flat flags to protocol trailers using camelCase', () => {
      const input = parseFlagsToInput({ 
          subject: 'feat: add login',
          confidence: 'high'
      }, registry);

      expect(input.subject).toBe('feat: add login');
      expect(input.trailers?.get('mock')?.['Confidence']).toEqual(['high']);
    });

    it('should support explicit catch-all --trailer flags', () => {
        const input = parseFlagsToInput({ 
            trailer: ['Confidence=medium', 'Constraint=rule1']
        }, registry);

        expect(input.trailers?.get('mock')?.['Confidence']).toEqual(['medium']);
        expect(input.trailers?.get('mock')?.['Constraint']).toEqual(['rule1']);
    });

    it('should merge duplicate values from short flags and explicit trailers', () => {
        const input = parseFlagsToInput({ 
            confidence: 'high',
            trailer: ['Confidence=medium']
        }, registry);

        expect(input.trailers?.get('mock')?.['Confidence']).toEqual(['high', 'medium']);
    });

    it('should support multiple values for a single key in catch-all flag', () => {
        const input = parseFlagsToInput({ 
            trailer: ['Constraint=c1', 'Constraint=c2']
        }, registry);

        expect(input.trailers?.get('mock')?.['Constraint']).toEqual(['c1', 'c2']);
    });

    it('should support qualified trailers (Protocol/Key=Value)', () => {
        const p1 = makeStubProtocolContext({ 
            name: 'P1', 
            namespace: 'p1', 
            trailers: { Status: { description: 'S', multivalue: false, validation: 'none' } } 
        });
        const p2 = makeStubProtocolContext({ 
            name: 'P2', 
            namespace: 'p2', 
            trailers: { Status: { description: 'S', multivalue: false, validation: 'none' } } 
        });
        const localRegistry = makeStubProtocolRegistry([p1 as any, p2 as any]);
        
        const options: any = {
            trailer: ['P1/Status=active', 'P2/Status=pending']
        };
    
        const result = parseFlagsToInput(options, localRegistry);
    
        expect(result.trailers?.get('p1')!.Status).toEqual(['active']);
        expect(result.trailers?.get('p2')!.Status).toEqual(['pending']);
    });

    it('should default unqualified trailers to the root protocol if it is the only owner', () => {
        const p1 = makeStubProtocolContext({ 
            name: 'Root', 
            namespace: '', 
            trailers: { Status: { description: 'S', multivalue: false, validation: 'none' } } 
        });
        const p2 = makeStubProtocolContext({ 
            name: 'NS', 
            namespace: 'ns', 
            trailers: { Other: { description: 'O', multivalue: false, validation: 'none' } } 
        });
        const localRegistry = makeStubProtocolRegistry([p1 as any, p2 as any]);
        
        const options: any = {
            trailer: ['Status=active']
        };
    
        const result = parseFlagsToInput(options, localRegistry);
        expect(result.trailers?.get('root')!.Status).toEqual(['active']);
    });

    it('should ignore unknown flags that do not match any protocol trailers (Current Behavior)', () => {
        // NOTE: Strictly speaking, this should warn or error (See Roadmap Phase 7.7)
        // But for now, we allow them to pass through to satisfy global CLI options.
        const input = parseFlagsToInput({ unknown: 'val' } as any, registry);
        expect(input.trailers?.size).toBe(0);
    });

    it('should prioritize explicit cli flags over automatic ones', () => {
        const customProtocol = makeStubProtocolContext({
          ...TEST_PROTOCOL_DEFINITION,
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
    
        const result = parseFlagsToInput(options, makeStubProtocolRegistry([customProtocol as any]));
    
        const mockGroup = result.trailers?.get('mock') || {};
        expect(mockGroup.Department).toEqual(['Eng']);
    });

    it('should automatically slugify custom trailer keys into CLI flags', () => {
        const customProtocol = makeStubProtocolContext({
          ...TEST_PROTOCOL_DEFINITION,
          trailers: {
              'Regulatory-Compliance': {
                description: 'Check for compliance',
                multivalue: true,
                validation: 'none',
              }
          }
        });
        
        const options = {
          subject: 'feat',
          regulatoryCompliance: ['GDPR', 'HIPAA'],
        };
    
        const result = parseFlagsToInput(options as any, makeStubProtocolRegistry([customProtocol as any]));
    
        const mockGroup = result.trailers?.get('mock') || {};
        expect(mockGroup['Regulatory-Compliance']).toEqual(['GDPR', 'HIPAA']);
    });

    it('should preserve existing trailers when adding custom ones', () => {
        const options: any = {
          subject: 'feat',
          confidence: 'low',
          trailer: ['Confidence=high', 'Department=Eng'],
        };
    
        const result = parseFlagsToInput(options, makeStubProtocolRegistry([makeStubProtocolContext({
            ...TEST_PROTOCOL_DEFINITION,
            trailers: { 
                ...TEST_PROTOCOL_DEFINITION.trailers, 
                ...MOCK_CORE_TRAILERS,
                'Department': { description: 'D', multivalue: false, validation: 'none' } 
            }
        }) as any]));
    
        const mockGroup = result.trailers?.get('mock') || {};
        expect(mockGroup.Confidence).toEqual(['low', 'high']);
        expect(mockGroup.Department).toEqual(['Eng']);
    });

    it('should default subject to empty string when undefined', () => {
        const result = parseFlagsToInput({}, makeStubProtocolRegistry([mockProtocol as any]));
        expect(result.subject).toBe('');
    });

    describe('Logic Parity', () => {
        it('should leave body undefined when not provided', () => {
            const input = parseFlagsToInput({ subject: 's' }, registry);
            expect(input.body).toBeUndefined();
        });
    
        it('should map core trailers dynamically using metadata', () => {
            const input = parseFlagsToInput({ subject: 's', confidence: 'high' }, registry);
            expect(input.trailers?.get('mock')?.Confidence).toEqual(['high']);
        });
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

