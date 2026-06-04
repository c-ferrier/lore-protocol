import type { FormattableTrailerDefinition } from '../../core/types/output.js';
import type { TrailerUiKind, TrailerUiColor } from '../../core/types/config.js';
import type { ProtocolContext } from '../../core/types/protocol-definition.js';
import { getFormattableDefinitions as getBaseFormattable } from '../../core/logic/protocols.js';

/**
 * Pure functions for extracting UI metadata from a Protocol schema.
 */

export function getFormattableDefinitions(ctx: ProtocolContext): Record<string, FormattableTrailerDefinition> {
    return getBaseFormattable(ctx);
}

export function getUiKind(ctx: ProtocolContext, key: string): TrailerUiKind {
    const canonical = ctx.caseMap.get(key.toLowerCase());
    const def = canonical ? ctx.def.trailers[canonical] : null;
    return (def?.ui?.kind || 'text') as any;
}

export function getUiColor(ctx: ProtocolContext, key: string): TrailerUiColor {
    const canonical = ctx.caseMap.get(key.toLowerCase());
    const def = canonical ? ctx.def.trailers[canonical] : null;
    return def?.ui?.color || 'dim';
}
