import { describe, it, expect, beforeEach } from 'vitest';
import { JsonFormatter } from '../../../src/engine/formatters/json-formatter.js';
import { TextFormatter } from '../../../src/engine/formatters/text-formatter.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import type { FormattableQueryResult } from '../../../src/engine/types/output.js';
import type { Atom } from '../../../src/engine/types/domain.js';

describe('Agnostic Output (Zero Protocols)', () => {
  let registry: ProtocolRegistry;
  
  const mockAtom: Atom = {
    commitHash: 'abc1234567890',
    date: new Date('2026-05-25T12:00:00Z'),
    author: 'cole@example.com',
    subject: 'feat: agnostic commit',
    body: 'Some body text',
    protocols: new Map(), // No protocol interpretations
    filesChanged: ['src/main.ts'],
  };

  const mockData: FormattableQueryResult = {
    result: {
      command: 'log',
      target: 'repository',
      targetType: 'global',
      atoms: [mockAtom],
      meta: {
        totalAtoms: 1,
        filteredAtoms: 1,
        oldest: mockAtom.date,
        newest: mockAtom.date,
      },
    },
    supersessionMap: new Map(),
    visibleTrailers: 'all',
  };

  beforeEach(() => {
    registry = new ProtocolRegistry();
  });

  describe('JsonFormatter', () => {
    it('should use "subject" key by default and return empty protocols map', () => {
      const formatter = new JsonFormatter(registry);
      const output = JSON.parse(formatter.formatQueryResult(mockData));

      const firstResult = output.results[0];
      expect(firstResult.subject).toBe('feat: agnostic commit');
      expect(firstResult.protocols).toEqual({});
      expect(firstResult.commit).toBe('abc1234567890');
    });

    it('should allow overriding the subject key via subclassing (Wrapping Pattern)', () => {
      class CustomJsonFormatter extends JsonFormatter {
          protected override getSubjectKey(): string {
              return 'decision_intent';
          }
      }
      const formatter = new CustomJsonFormatter(registry);
      const output = JSON.parse(formatter.formatQueryResult(mockData));

      const firstResult = output.results[0];
      expect(firstResult.decision_intent).toBe('feat: agnostic commit');
      expect(firstResult.subject).toBeUndefined();
    });
  });

  describe('TextFormatter', () => {
    it('should fallback to shortened commit hash when no protocols are registered', () => {
      const formatter = new TextFormatter(registry, { color: false });
      const output = formatter.formatQueryResult(mockData);

      // Header should show first 8 chars of hash
      expect(output).toContain('abc12345');
      expect(output).toContain('feat: agnostic commit');
    });

    it('should use generic nomenclature in footer', () => {
        const formatter = new TextFormatter(registry, { color: false });
        const output = formatter.formatQueryResult(mockData);
        expect(output).toContain('1 of 1 atoms shown');
    });

    it('should show "No decision atoms found." when empty', () => {
        const formatter = new TextFormatter(registry, { color: false });
        const emptyData = { ...mockData, result: { ...mockData.result, atoms: [] } };
        const output = formatter.formatQueryResult(emptyData);
        expect(output).toContain('No decision atoms found.');
    });
  });
});
