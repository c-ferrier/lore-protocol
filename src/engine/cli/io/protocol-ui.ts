import type { ActiveProtocol } from '../../core/models/active-protocol.js';
import type { FormattableTrailerDefinition } from '../../core/types/output.js';
import type { TrailerUiKind, TrailerUiColor } from '../../core/types/config.js';

/**
 * Pure functions for extracting UI metadata from a Protocol schema.
 */

export function getFormattableDefinitions(protocol: ActiveProtocol): Record<string, FormattableTrailerDefinition> {
    const results: Record<string, FormattableTrailerDefinition> = {};
    const keys = protocol.getAuthorizedKeys();

    for (const key of keys) {
        const def = protocol.getDefinition(key);
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

export function getUiKind(protocol: ActiveProtocol, key: string): TrailerUiKind {
    const def = protocol.getDefinition(key);
    return (def?.ui?.kind || 'text') as any;
}

export function getUiColor(protocol: ActiveProtocol, key: string): TrailerUiColor {
    const def = protocol.getDefinition(key);
    return def?.ui?.color || 'dim';
}
