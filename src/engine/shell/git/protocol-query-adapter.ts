import type { ProtocolContext } from '../../core/types/protocol-definition.js';
import type { QualifiedFilter } from '../../core/types/query.js';
import type { ProtocolState } from '../../core/types/domain.js';
import * as logic from '../../core/logic/query-adapter.js';

/**
 * Generates regex patterns to find commits belonging to this protocol.
 * Public wrapper that respects mock hooks in tests.
 */
export function getDiscoveryPatterns(ctx: ProtocolContext): string[] {
    // Support method override via the definition object (used by mocks in tests)
    if ((ctx.def as any).getDiscoveryPatterns) return (ctx.def as any).getDiscoveryPatterns();
    return logic.getDiscoveryPatterns(ctx);
}

/**
 * Generates a specific pattern to find a single identity.
 */
export function getIdentityPattern(id: string, ctx: ProtocolContext): string {
    return logic.getIdentityPattern(id, ctx);
}

/**
 * Translates structured filters into git log grep patterns.
 * Public wrapper that respects mock hooks in tests.
 */
export function getSearchPatterns(filters: readonly QualifiedFilter[], ctx: ProtocolContext): string[][] {
    // Support method override via the definition object (used by mocks in tests)
    if ((ctx.def as any).getSearchPatterns) return (ctx.def as any).getSearchPatterns(filters);
    return logic.getSearchPatterns(filters, ctx);
}

/**
 * Evaluates if a protocol state matches a set of filters.
 * Public wrapper that respects mock hooks in tests.
 */
export function matchesFilters(state: ProtocolState, filters: readonly QualifiedFilter[], ctx: ProtocolContext): boolean {
    // Support method override via the definition object (used by mocks in tests)
    if ((ctx.def as any).matches) return (ctx.def as any).matches(state, filters);
    
    // NEW: Check functional hook on context
    if (ctx.matches) return ctx.matches(state, filters);

    return logic.matchesFilters(state, filters, ctx);
}

/**
 * Determines if this protocol claims a block of raw trailers.
 * Public wrapper that respects mock hooks in tests.
 */
export function claimsTrailers(rawTrailers: string, ctx: ProtocolContext): boolean {
    // Support method override via the definition object (used by mocks in tests)
    if ((ctx.def as any).claims) return (ctx.def as any).claims(rawTrailers);
    
    // NEW: Check functional hook on context
    if (ctx.claims) return ctx.claims(rawTrailers);

    return logic.claimsTrailers(rawTrailers, ctx);
}
