import { describe, it, expect, beforeEach } from 'vitest';
import { LoreTextFormatter } from '../../../../src/lore/formatters/lore-text-formatter.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { makeAtom } from '../../../engine/engine-test-utils.js';

describe('LoreTextFormatter Author Parity', () => {
  let formatter: LoreTextFormatter;

  beforeEach(() => {
    formatter = new LoreTextFormatter(new ProtocolRegistry(), { color: false });
  });

  it('should extract email from "Name <email>" format', () => {
    const atom = makeAtom({ author: 'Cole <cole@example.com>' });
    const header = (formatter as any).formatAtomHeader(atom, 'aaaa1111', false);
    
    // Header format: ── ID (date, email) ──
    expect(header).toContain('(2025-01-15, cole@example.com)');
    expect(header).not.toContain('Cole');
  });

  it('should handle raw email format gracefully', () => {
    const atom = makeAtom({ author: 'cole@example.com' });
    const header = (formatter as any).formatAtomHeader(atom, 'aaaa1111', false);
    
    expect(header).toContain('(2025-01-15, cole@example.com)');
  });

  it('should handle malformed author strings gracefully', () => {
    const atom = makeAtom({ author: 'Cole <malformed' });
    const header = (formatter as any).formatAtomHeader(atom, 'aaaa1111', false);
    
    // Should fallback to showing the whole string if no closing bracket
    expect(header).toContain('(2025-01-15, Cole <malformed)');
  });
});
