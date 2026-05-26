import { describe, it, expect, beforeEach } from 'vitest';
import { LoreJsonFormatter } from '../../../../src/lore/formatters/lore-json-formatter.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { LoreProtocolDefinition } from '../../../../src/lore/protocol-definition.js';
import { LORE_DEFAULT_CONFIG } from '../../../../src/lore/defaults.js';
import type { FormattableQueryResult } from '../../../../src/engine/types/output.js';
import type { Atom, Trailers } from '../../../../src/engine/types/domain.js';

const LORE_ID_KEY = "Lore-id";

function makeTrailers(overrides: Partial<Trailers> = {}): Trailers {
  return {
    [LORE_ID_KEY]: overrides[LORE_ID_KEY] ?? ['a1b2c3d4'],
    Confidence: overrides.Confidence ?? ['high'],
    'Scope-risk': overrides['Scope-risk'] ?? ['narrow'],
    ...overrides,
  } as any;
}

function makeAtom(overrides: Partial<Atom> = {}): Atom {
  const trailers = (overrides as any).trailers ?? makeTrailers();
  return {
    commitHash: overrides.commitHash ?? 'h1',
    date: overrides.date ?? new Date('2025-01-15T10:00:00Z'),
    author: 'alice@example.com',
    subject: overrides.subject ?? 'feat: legacy test',
    body: '',
    protocols: new Map([
      ['lore', { name: 'Lore', version: '1.0', identityKey: LORE_ID_KEY, trailers }]
    ]),
    filesChanged: ['src/f1.ts'],
    ...overrides,
  };
}

describe('LoreJsonFormatter (0.5.0 Parity)', () => {
  let registry: ProtocolRegistry;
  let formatter: LoreJsonFormatter;

  beforeEach(() => {
    registry = new ProtocolRegistry();
    registry.register(new Protocol(LoreProtocolDefinition, LORE_DEFAULT_CONFIG));
    formatter = new LoreJsonFormatter(registry);
  });

  it('should transform agnostic output to flat Lore 0.5.0 structure', () => {
    const atom = makeAtom();
    const data: FormattableQueryResult = {
      result: {
        command: 'log',
        target: 'all',
        targetType: 'global',
        atoms: [atom],
        meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
      },
      supersessionMap: new Map(),
      visibleTrailers: 'all',
    };

    const output = formatter.formatQueryResult(data);
    const parsed = JSON.parse(output);

    // 1. Root Identity Parity
    expect(parsed.results[0].lore_id).toBe('a1b2c3d4');
    
    // 2. Nomenclature Parity (Intent)
    expect(parsed.results[0].intent).toBe('feat: legacy test');
    
    // 3. Flat Trailer Parity with snake_case
    expect(parsed.results[0].trailers.lore_id).toBe('a1b2c3d4');
    expect(parsed.results[0].trailers.confidence).toBe('high');
    expect(parsed.results[0].trailers.scope_risk).toBe('narrow');
    
    // 4. Root Version Parity
    expect(parsed.lore_version).toBe('1.0');
  });

  it('should format commit success with the simple 0.5.0 message structure', () => {
    const output = formatter.formatSuccess('Some git message', { hash: 'deadbeef' });
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe('Commit created: deadbeef');
    expect(parsed.hash).toBe('deadbeef');
    expect(parsed.lore_version).toBe('1.0');
    
    // Negative checks: no engine leakage
    expect(parsed.protocols).toBeUndefined();
    expect(parsed.ids).toBeUndefined();
  });
});
