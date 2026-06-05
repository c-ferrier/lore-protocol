import { describe, it, expect } from 'vitest';
import { ProtocolHydrator } from '../../../../src/engine/shell/fs/protocol-hydrator.js';

describe('ProtocolHydrator (Implementation)', () => {
  it('should hydrate a simple string trailer into a definition', () => {
    const def = ProtocolHydrator.hydrateTrailer('Mock', 'A description');
    expect(def.description).toBe('A description');
    expect(def.multivalue).toBe(true);
  });

  it('should preserve full definitions', () => {
      const input = { description: 'D', multivalue: true, validation: 'none' as const };
      const def = ProtocolHydrator.hydrateTrailer('Mock', input);
      expect(def).toEqual(expect.objectContaining(input));
  });
});
