import { join } from 'node:path';
import type { ProtocolDefinition } from '../../interfaces/protocol-definition.js';
import type { EngineConfig } from '../../types/config.js';
import { ProtocolHydrator } from '../protocol-hydrator.js';
import { DynamicProtocolLoader } from '../protocol-loader.js';
import { PROTOCOLS_DIR_NAME } from '../../util/constants.js';

/**
 * High-level orchestrator for loading and merging protocol definitions.
 * Combines static library definitions with dynamic repository-local blueprints
 * and applies repo-level configuration overrides.
 * 
 * SOLID: SRP -- focused purely on the 'Knowledge Hydration' lifecycle.
 */
export class ProtocolLoader {
  constructor(
    private readonly dynamicLoader: DynamicProtocolLoader,
    private readonly staticProtocols: ProtocolDefinition[]
  ) {}

  /**
   * Loads all available protocols, performing hybrid merging and override application.
   */
  async loadAll(config: EngineConfig): Promise<ProtocolDefinition[]> {
    // 1. Load Dynamic Blueprints from .atom/protocols/*.toml
    const dynamicProtocols = await this.dynamicLoader.loadAll();

    // 2. Perform Hybrid Merge (Blueprints + Static Hooks)
    const merged = this.mergeProtocols(dynamicProtocols, this.staticProtocols);

    // 3. Apply Local Overrides (from config.protocols bucket)
    const finalized = ProtocolLoader.applyOverrides(merged, config.protocols);

    // 4. Final Pass: Standardize all trailer schemas via Hydrator
    return finalized.map(def => this.hydrateDefinition(def));
  }

  /**
   * Merges dynamic blueprints with static definitions.
   * If a protocol exists in both, the static hooks (like getStaleSignals)
   * are attached to the dynamic schema.
   */
  private mergeProtocols(
    dynamic: ProtocolDefinition[], 
    staticDefs: ProtocolDefinition[]
  ): ProtocolDefinition[] {
    const results: ProtocolDefinition[] = [];
    const dynamicMap = new Map(dynamic.map(p => [p.name.toLowerCase(), p]));
    const staticMap = new Map(staticDefs.map(p => [p.name.toLowerCase(), p]));
    const allNames = new Set([...dynamicMap.keys(), ...staticMap.keys()]);

    for (const name of allNames) {
        const discovered = dynamicMap.get(name);
        const staticDef = staticMap.get(name);

        if (discovered && staticDef) {
            // HYBRID: Schema from Repo + Logic Hooks from Library
            results.push({
                ...discovered,
                getStaleSignals: staticDef.getStaleSignals
            });
        } else if (discovered) {
            results.push(discovered);
        } else if (staticDef) {
            results.push(staticDef);
        }
    }

    return results;
  }

  /**
   * Applies repository-level overrides from config.toml to the definitions.
   * 
   * DESIGN: Static so it can be re-used by unit tests for high-fidelity mocking
   * without requiring an asynchronous service instance.
   */
  static applyOverrides(
    definitions: ProtocolDefinition[], 
    overrides: Record<string, any> = {}
  ): ProtocolDefinition[] {
    return definitions.map(def => {
        const safeOverrides = overrides || {};
        const override = safeOverrides[def.name] || safeOverrides[def.name.toLowerCase()];
        if (!override) return def;

        // Apply top-level overrides
        const merged: ProtocolDefinition = {
            ...def,
            version: override.version || def.version,
            strict: override.strict !== undefined ? override.strict : def.strict,
            permissive: override.permissive !== undefined ? override.permissive : def.permissive,
            namespace: override.namespace !== undefined ? override.namespace : def.namespace,
            identityKey: override.identity_key || override.identityKey || def.identityKey,
            // DEEP CLONE TRAILERS to prevent mutation pollution
            trailers: { ...def.trailers }
        };

        // Apply trailer-level overrides
        if (override.trailers) {
            for (const [key, tOverride] of Object.entries(override.trailers)) {
                const existing = def.trailers[key] || {};
                (merged.trailers as any)[key] = {
                    ...existing,
                    ...(tOverride as any)
                };
            }
        }

        return merged;
    });
  }

  /**
   * Ensures all trailers in a definition are formally hydrated.
   */
  private hydrateDefinition(def: ProtocolDefinition): ProtocolDefinition {
    const hydratedTrailers: Record<string, any> = {};
    for (const [key, t] of Object.entries(def.trailers)) {
        hydratedTrailers[key] = ProtocolHydrator.hydrateTrailer(key, t);
    }
    return {
        ...def,
        trailers: hydratedTrailers
    };
  }

  /**
   * Factory method to create a loader for a specific repository root.
   */
  static create(activeRoot: string, engineDirName: string, staticProtocols: ProtocolDefinition[]): ProtocolLoader {
    const protocolsDir = join(activeRoot, engineDirName, PROTOCOLS_DIR_NAME);
    return new ProtocolLoader(
        new DynamicProtocolLoader(protocolsDir),
        staticProtocols
    );
  }
}
