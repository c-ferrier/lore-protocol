import { describe, expect, it, vi } from 'vitest';

import { type EngineConfig } from '../../../../src/engine/core/types/config.js';
import { type ProtocolDefinition } from '../../../../src/engine/core/types/protocol-definition.js';
import { ProtocolLoader } from '../../../../src/engine/shell/fs/protocol-loader.js';
import { TEST_ENGINE_CONFIG } from '../../../../src/engine/testing.js';
;


;

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
  };

  it('should apply repository-level configuration overrides', async () => {
    const loader = new ProtocolLoader(
        createMockDynamicLoader([staticLore]),
        []
    );

    const configWithOverrides: EngineConfig = {
      ...TEST_ENGINE_CONFIG,
      protocols: {
        Lore: {
          strict: true,
          permissive: false,
          trailers: {
            'Custom-Field': { description: 'Overridden', multivalue: true, validation: 'none' } as any
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

    const results = await loader.loadAll(TEST_ENGINE_CONFIG);
    const testP = results[0];
    
    // String was hydrated into a full TrailerDefinition object
    expect(typeof testP.trailers.Raw).toBe('object');
    expect(testP.trailers.Raw.description).toBe('Simple String Definition');
  });
});