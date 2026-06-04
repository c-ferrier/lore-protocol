import type { ProtocolDefinition, ProtocolContext } from '../types/protocol-definition.js';
import type { FormattableTrailerDefinition } from '../types/output.js';
import { ProtocolHydrator } from '../../shell/fs/protocol-hydrator.js';

/**
 * Transforms a serializable ProtocolDefinition into an operationally optimized ProtocolContext.
 * Performs expensive schema iteration once at bootstrap.
 */
export function createProtocolContext(def: ProtocolDefinition): ProtocolContext {
    const caseMap = new Map<string, string>();
    const trailers = new Map<string, any>();
    
    const rawTrailers = def.trailers || {};
    const namespace = def.namespace || '';

    for (const [key, tDef] of Object.entries(rawTrailers)) {
        caseMap.set(key.toLowerCase(), key);
        
        const hydrated = ProtocolHydrator.hydrateTrailer(key, tDef);
        const isCore = (hydrated as any).isCore ?? false;
        trailers.set(key, { ...hydrated, key, isCore });
    }

    return {
        def,
        caseMap,
        trailers,
        isRoot: namespace === '',
        storagePrefix: namespace !== '' ? `${namespace}: ` : '',
    };
}

/**
 * Returns all trailer keys explicitly defined in the protocol schema.
 * Result is sorted numerically by 'prompt.order' (ascending).
 */
export function getAuthorizedKeys(ctx: ProtocolContext): string[] {
    return Array.from(ctx.trailers.keys()).sort((a, b) => {
        const orderA = ctx.trailers.get(a)?.prompt?.order ?? 1000;
        const orderB = ctx.trailers.get(b)?.prompt?.order ?? 1000;
        return orderA - orderB;
    });
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

        results[key] = {
            ...tDef,
            ui: {
                kind: (tDef.ui?.kind || 'text') as any,
                color: tDef.ui?.color || 'dim',
            }
        } as any;
    }

    return results;
}
