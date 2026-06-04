import type { ProtocolDefinition, ProtocolContext } from '../types/protocol-definition.js';
import type { FormattableTrailerDefinition } from '../types/output.js';

/**
 * Transforms a serializable ProtocolDefinition into an operationally optimized ProtocolContext.
 * Performs expensive schema iteration once at bootstrap.
 */
export function createProtocolContext(def: ProtocolDefinition): ProtocolContext {
    const caseMap = new Map<string, string>();
    
    const trailers = def.trailers || {};
    const namespace = def.namespace || '';

    for (const key of Object.keys(trailers)) {
        caseMap.set(key.toLowerCase(), key);
    }

    return {
        def,
        caseMap,
        isRoot: namespace === '',
        storagePrefix: namespace !== '' ? `${namespace}: ` : '',
    };
}

/**
 * Returns all trailer keys explicitly defined in the protocol schema.
 * Result is sorted numerically by 'prompt.order' (ascending).
 */
export function getAuthorizedKeys(ctx: ProtocolContext): string[] {
    return Object.keys(ctx.def.trailers).sort((a, b) => {
        const orderA = ctx.def.trailers[a]?.prompt?.order ?? 1000;
        const orderB = ctx.def.trailers[b]?.prompt?.order ?? 1000;
        return orderA - orderB;
    });
}

/**
 * Returns all schema-defined keys that allow only a single value.
 */
export function getScalarKeys(ctx: ProtocolContext): string[] {
    return getAuthorizedKeys(ctx).filter(k => !ctx.def.trailers[k]?.multivalue);
}

/**
 * Returns all schema-defined keys that allow multiple values.
 */
export function getListKeys(ctx: ProtocolContext): string[] {
    return getAuthorizedKeys(ctx).filter(k => ctx.def.trailers[k]?.multivalue);
}

/**
 * Returns all schema-defined keys that serve as references to other atoms.
 */
export function getReferenceKeys(ctx: ProtocolContext): string[] {
    return getAuthorizedKeys(ctx).filter(k => ctx.def.trailers[k]?.validation === 'reference');
}

/**
 * Checks if a trailer key is marked as a core protocol trailer.
 */
export function isCoreTrailer(key: string, ctx: ProtocolContext): boolean {
    const canonical = ctx.caseMap.get(key.toLowerCase());
    if (!canonical) return false;
    return ctx.def.trailers[canonical]?.isCore ?? false;
}

/**
 * Transforms all schema definitions into a record for UI display.
 */
export function getFormattableDefinitions(ctx: ProtocolContext): Record<string, FormattableTrailerDefinition> {
    const results: Record<string, FormattableTrailerDefinition> = {};
    const keys = getAuthorizedKeys(ctx);

    for (const key of keys) {
        const def = ctx.def.trailers[key];
        if (!def) continue;

        results[key] = {
            ...def,
            ui: {
                kind: (def.ui?.kind || 'text') as any,
                color: def.ui?.color || 'dim',
            }
        } as any;
    }

    return results;
}
