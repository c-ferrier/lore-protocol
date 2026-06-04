import type { ProtocolDefinition, ProtocolContext } from '../types/protocol-definition.js';

/**
 * Transforms a serializable ProtocolDefinition into an operationally optimized ProtocolContext.
 * Performs expensive schema iteration once at bootstrap.
 */
export function createProtocolContext(def: ProtocolDefinition): ProtocolContext {
    const caseMap = new Map<string, string>();
    
    const trailers = def.trailers || {};
    for (const key of Object.keys(trailers)) {
        caseMap.set(key.toLowerCase(), key);
    }

    const namespace = def.namespace || '';

    return {
        def,
        caseMap,
        isRoot: namespace === '',
        storagePrefix: namespace !== '' ? `${namespace}: ` : '',
    };
}
