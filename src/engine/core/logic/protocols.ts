import { ProtocolHydrator } from '../../shell/fs/protocol-hydrator.js';
import { ProtocolError } from '../../util/errors.js';
import { ProtocolMap } from '../models/protocol-map.js';
import type { TrailerDefinition } from '../types/config.js';
import type { FormattableTrailerDefinition } from '../types/output.js';
import type {ProtocolContext, ProtocolDefinition } from '../types/protocol-definition.js';
import { authorizeKey } from './ownership.js';
import { isValidProtocolIdentity } from './validation.js';

/**
 * Transforms a serializable ProtocolDefinition into an operationally optimized ProtocolContext.
 * Performs expensive schema iteration once at bootstrap.
 */
export function createProtocolContext(def: ProtocolDefinition): ProtocolContext {
    const caseMap = new Map<string, string>();
    const trailers = new Map<string, TrailerDefinition & { key: string }>();
    
    const rawTrailers = { ...(def.trailers || {}) };
    const namespace = def.namespace || '';

    // Ensure identity key is present in rawTrailers for iteration
    if (!rawTrailers[def.identityKey]) {
        rawTrailers[def.identityKey] = { description: 'Stable identity', multivalue: false, validation: 'none' };
    }

    for (const [key, tDef] of Object.entries(rawTrailers)) {
        caseMap.set(key.toLowerCase(), key);
        
        const hydrated = ProtocolHydrator.hydrateTrailer(key, tDef);
        const isCore = hydrated.isCore ?? false;
        
        // Identity key always defaults to order 0 if not set
        const prompt = { ...(hydrated.prompt || {}) };
        if (key === def.identityKey && prompt.order === undefined) {
            prompt.order = 0;
        }

        trailers.set(key, { ...hydrated, key, isCore, prompt });
    }

    const ctx: ProtocolContext = {
        def,
        caseMap,
        trailers,
        isRoot: namespace === '',
        storagePrefix: namespace !== '' ? `${namespace}: ` : '',
        
        // Populate convenience properties
        name: def.name.toLowerCase(),
        version: def.version,
        strict: def.strict ?? true,
        permissive: def.permissive ?? false,
        identityKey: def.identityKey,
        storageNamespace: namespace
    };

    return ctx;
}

/**
 * Returns all trailer keys explicitly defined in the protocol schema.
 * Pure logic: strictly uses context data.
 */
export function getProtocolAuthorizedKeys(ctx: ProtocolContext): string[] {
    return Array.from(ctx.trailers.keys()).sort((a, b) => {
        const orderA = ctx.trailers.get(a)?.prompt?.order ?? 1000;
        const orderB = ctx.trailers.get(b)?.prompt?.order ?? 1000;
        return orderA - orderB;
    });
}

/**
 * Public wrapper for authorized keys.
 */
export function getAuthorizedKeys(ctx: ProtocolContext): string[] {
    return getProtocolAuthorizedKeys(ctx);
}

/**
 * Returns a set of all primary keys reserved by any registered protocol.
 */
export function getClaimedProtocolKeys(protocols: ProtocolMap<ProtocolContext>): Set<string> {
    const claimed = new Set<string>();
    for (const ctx of protocols.values()) {
      const ns = ctx.storageNamespace;
      if (ns !== '') {
        claimed.add(ns.toLowerCase());
      } else {
        // Map all authorized keys from the context
        for (const k of getAuthorizedKeys(ctx)) {
          claimed.add(k.toLowerCase());
        }
      }
    }
    return claimed;
}

/**
 * Returns the protocol context that owns the root (unprefixed) namespace.
 */
export function getRootProtocol(protocols: ProtocolMap<ProtocolContext>): ProtocolContext | undefined {
    return Array.from(protocols.values()).find(p => p.isRoot);
}

/**
 * Resolves a trailer key to its owning protocol context.
 */
export function resolveProtocolKey(protocols: ProtocolMap<ProtocolContext>, key: string): ProtocolContext | undefined {
    // 1. Check all protocol schemas
    for (const ctx of protocols.values()) {
        if (authorizeKey(key, ctx)) return ctx;
    }

    // 2. Check namespace keys (using lowercase for normalization)
    const nsKey = key.toLowerCase();
    for (const ctx of protocols.values()) {
        if (ctx.storageNamespace.toLowerCase() === nsKey) return ctx;
    }

    // 3. Fallback to Root
    return getRootProtocol(protocols);
}

/**
 * Resolves a raw trailer value into a qualified QueryIdentity.
 */
export function resolveProtocolIdentity(
    protocols: ProtocolMap<ProtocolContext>, 
    id: string, 
    contextProtocol?: string
): { id: string; protocol: string } {
    if (id.includes('/')) {
      const [prefix, suffix] = id.split('/', 2);
      // Prefix can be name OR namespace
      const ctx = protocols.get(prefix) || Array.from(protocols.values()).find(c => c.storageNamespace.toLowerCase() === prefix.toLowerCase());
      if (!ctx) {
        throw new ProtocolError(`Unknown protocol prefix: "${prefix}" in identity "${id}"`, 1);
      }
      return { id: suffix, protocol: ctx.name };
    }

    if (contextProtocol) {
      const ctx = protocols.get(contextProtocol);
      if (ctx && isValidProtocolIdentity(id, ctx.def)) {
        return { id, protocol: ctx.name };
      }
    }

    // Deterministic lookup: who owns this ID format?
    for (const ctx of protocols.values()) {
        if (isValidProtocolIdentity(id, ctx.def)) return { id, protocol: ctx.name };
    }

    const root = getRootProtocol(protocols);
    if (!root) throw new ProtocolError(`Cannot resolve reference "${id}": no global protocol defined`, 1);
    
    return { id, protocol: root.name };
}

/**
 * Returns all schema-defined keys that allow only a single value.
 */
export function getScalarKeys(ctx: ProtocolContext): string[] {
    return getAuthorizedKeys(ctx).filter(k => !ctx.trailers.get(k)?.multivalue);
}

/**
 * Returns all schema-defined keys that allow multiple values.
 */
export function getListKeys(ctx: ProtocolContext): string[] {
    return getAuthorizedKeys(ctx).filter(k => ctx.trailers.get(k)?.multivalue);
}

/**
 * Returns all schema-defined keys that serve as references to other atoms.
 */
export function getReferenceKeys(ctx: ProtocolContext): string[] {
    return getAuthorizedKeys(ctx).filter(k => ctx.trailers.get(k)?.validation === 'reference');
}

/**
 * Checks if a trailer key is marked as a core protocol trailer.
 */
export function isCoreTrailer(key: string, ctx: ProtocolContext): boolean {
    const canonical = ctx.caseMap.get(key.toLowerCase());
    if (!canonical) return false;
    return ctx.trailers.get(canonical)?.isCore ?? false;
}

/**
 * Transforms all schema definitions into a record for UI display.
 */
export function getFormattableDefinitions(ctx: ProtocolContext): Record<string, FormattableTrailerDefinition> {
    const results: Record<string, FormattableTrailerDefinition> = {};
    const keys = getAuthorizedKeys(ctx);

    for (const key of keys) {
        const tDef = ctx.trailers.get(key);
        if (!tDef) continue;

        // Ensure values are fully hydrated into objects for UI consistency
        const hydratedValues: Record<string, { description: string }> = {};
        if (tDef.values) {
            for (const [vKey, vVal] of Object.entries(tDef.values)) {
                hydratedValues[vKey] = typeof vVal === 'string' ? { description: vVal } : vVal;
            }
        }

        results[key] = {
            ...tDef,
            values: tDef.values ? hydratedValues : undefined,
            directives: tDef.directives || [],
            isCore: tDef.isCore ?? false,
            ui: {
                kind: tDef.ui?.kind || 'custom',
                color: tDef.ui?.color || 'dim',
            }
        };
    }

    return results;
}
