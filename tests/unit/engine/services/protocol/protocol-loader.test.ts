import { describe, it, expect, vi } from 'vitest';
import { ProtocolLoader } from '../../../../../src/engine/services/protocol/protocol-loader.js';
import type { ProtocolDefinition } from '../../../../../src/engine/interfaces/protocol-definition.js';
import type { EngineConfig } from '../../../../../src/engine/types/config.js';
import { MOCK_CONFIG } from '../../test-utils.js';

describe('ProtocolLoader', () => {
  const createMockDynamicLoader = (protocols: ProtocolDefinition[]) => ({
    loadAll: vi.fn(async () => protocols),
  } as any);

  const staticLore: ProtocolDefinition = {
    name: 'Lore',
    version: '1.0',
    namespace: '',
    strict: false,
    permissive: true,
    identityKey: 'Lore-id',
    trailers: {},
    getStaleSignals: vi.fn()
  };

  it('should merge dynamic blueprints with static logic hooks', async () => {
    // Dynamic blueprint has trailers but NO logic hooks
    const dynamicSec: ProtocolDefinition = {
      name: 'Sec',
      version: '1.0',
      namespace: 'sec',
      strict: true,
      permissive: false,
      identityKey: 'CVE',
      trailers: { CVE: { description: 'id', multivalue: false, validation: 'none' } }
    };
    
    // Static hook for the SAME protocol
    const staleHook = vi.fn();
    const staticSec: ProtocolDefinition = {
        ...dynamicSec,
        trailers: {}, // empty trailers in static
        getStaleSignals: staleHook
    };

    const loader = new ProtocolLoader(
        createMockDynamicLoader([dynamicSec]),
        [staticSec]
    );

    const results = await loader.loadAll(MOCK_CONFIG);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Sec');
    expect(results[0].trailers.CVE).toBeDefined(); // Kept from dynamic
    expect(results[0].getStaleSignals).toBe(staleHook); // Merged from static
  });

  it('should apply repository-level configuration overrides', async () => {
    const loader = new ProtocolLoader(
        createMockDynamicLoader([staticLore]),
        []
    );

    const configWithOverrides: EngineConfig = {
      ...MOCK_CONFIG,
      protocols: {
        Lore: {
          strict: true,
          permissive: false,
          trailers: {
            'Custom-Field': { description: 'Overridden', multivalue: true }
          }
        }
      }
    };

    const results = await loader.loadAll(configWithOverrides);
    const lore = results.find(p => p.name === 'Lore')!;
    
    expect(lore.strict).toBe(true);
    expect(lore.permissive).toBe(false);
    expect(lore.trailers['Custom-Field']).toBeDefined();
    expect(lore.trailers['Custom-Field'].description).toBe('Overridden');
  });

  it('should hydrate all trailer definitions after merging', async () => {
    const dynamicProtocol: any = {
      name: 'Test',
      trailers: {
        'Raw': 'Simple String Definition'
      }
    };

    const loader = new ProtocolLoader(
        createMockDynamicLoader([dynamicProtocol]),
        []
    );

    const results = await loader.loadAll(MOCK_CONFIG);
    const testP = results[0];
    
    // String was hydrated into a full TrailerDefinition object
    expect(typeof testP.trailers.Raw).toBe('object');
    expect(testP.trailers.Raw.description).toBe('Simple String Definition');
  });
});
