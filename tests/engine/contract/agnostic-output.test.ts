import { beforeEach,describe, expect, it } from 'vitest';

import { JsonFormatter } from '../../../src/engine/cli/formatters/json-formatter.js';
import { TextFormatter } from '../../../src/engine/cli/formatters/text-formatter.js';
import { type Atom,ProtocolMap } from '../../../src/engine/core/types/domain.js';
import type { ProtocolContext } from '../../../src/engine/core/types/protocol-definition.js';

describe('Agnostic Output (Zero Protocols)', () => {
  let protocols: ProtocolMap<ProtocolContext>;
  
  const mockAtom: Atom = {
    commitHash: 'abc1234567890',
    date: new Date('2026-05-25T12:00:00Z'),
    author: 'cole@example.com',
    subject: 'feat: agnostic commit',
    body: 'Some body text',
    rawTrailers: '',
    protocols: new ProtocolMap(), // No protocol interpretations
    filesChanged: ['src/main.ts'],
  };

  beforeEach(() => {
    protocols = new ProtocolMap();
  });

  describe('JsonFormatter', () => {
    it('should use "subject" key by default and return empty protocols map', () => {
      const formatter = new JsonFormatter(protocols);
      const output = JSON.parse(formatter.formatQueryAtom(mockAtom));

      const data = output.data;
      expect(data.subject).toBe('feat: agnostic commit');
      expect(data.protocols).toEqual({});
      expect(data.commit).toBe('abc1234567890');
    });

    it('should allow overriding the subject key via subclassing (Wrapping Pattern)', () => {
      class CustomJsonFormatter extends JsonFormatter {
          protected override getSubjectKey(): string {
              return 'decision_intent';
          }
      }
      const formatter = new CustomJsonFormatter(protocols);
      const output = JSON.parse(formatter.formatQueryAtom(mockAtom));

      const data = output.data;
      expect(data.decision_intent).toBe('feat: agnostic commit');
      expect(data.subject).toBeUndefined();
    });
  });

  describe('TextFormatter', () => {
    it('should fallback to shortened commit hash when no protocols are registered', () => {
      const formatter = new TextFormatter(protocols, { color: false });
      const output = formatter.formatQueryAtom(mockAtom);

      // Header should show first 7 chars of hash
      expect(output).toContain('abc1234');
      expect(output).toContain('feat: agnostic commit');
    });

    it('should use generic nomenclature in footer', () => {
        const formatter = new TextFormatter(protocols, { color: false });
        const output = formatter.formatQueryFooter({ total: 1, filtered: 1, oldest: null, newest: null });
        expect(output).toContain('1 of 1 atoms shown');
    });
  });
});