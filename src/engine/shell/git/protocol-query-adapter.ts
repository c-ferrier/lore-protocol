import type { ProtocolContext, IProtocol } from '../../core/types/protocol-definition.js';
import type { QualifiedFilter, FilterOperator } from '../../core/types/query.js';
import type { ProtocolState } from '../../core/types/domain.js';
import { escapeRegex } from '../../util/regex.js';
import { ownsKey, authorizeKey } from '../../core/logic/ownership.js';

/**
 * Generates regex patterns to find commits belonging to this protocol.
 * STRICT SEGMENTATION: 
 * - Namespaced: Must start with "Namespace: "
 * - Root: Must start with "identityKey: " + its regex pattern if available.
 */
export function getDiscoveryPatterns(ctx: ProtocolContext): string[] {
    // Support method override via the definition object (used by mocks in tests)
    if ((ctx.def as any).getDiscoveryPatterns) return (ctx.def as any).getDiscoveryPatterns();

    const { def, isRoot } = ctx;
    if (!isRoot) {
        return [`^${escapeRegex(def.namespace)}:`];
    }

    const tDef = def.trailers[def.identityKey];
    let pattern = `^${escapeRegex(def.identityKey)}: `;
    
    // Include the identity pattern if available, or fallback to exact match to satisfy discovery tests
    if (tDef?.pattern) {
        const cleanPattern = tDef.pattern.replace(/^\^/, '').replace(/\$$/, '');
        pattern += cleanPattern;
    }
    
    return [pattern];
}

/**
 * Generates a specific pattern to find a single identity.
 */
export function getIdentityPattern(id: string, ctx: ProtocolContext): string {
    return `^${escapeRegex(ctx.storagePrefix)}${escapeRegex(ctx.def.identityKey)}: ${escapeRegex(id)}$`;
}

/**
 * Translates structured filters into git log grep patterns.
 */
export function getSearchPatterns(filters: readonly QualifiedFilter[], ctx: ProtocolContext): string[][] {
    // Support method override via the definition object (used by mocks in tests)
    if ((ctx.def as any).getSearchPatterns) return (ctx.def as any).getSearchPatterns(filters);

    const patterns: string[] = [];
    const { storagePrefix } = ctx;

    for (const filter of filters) {
        const authorizedKey = authorizeKey(filter.key, ctx);
        if (!authorizedKey) continue;

        // 2. Format based on operator
        if (filter.op === 'has') {
            patterns.push(`^${escapeRegex(storagePrefix)}${escapeRegex(authorizedKey)}:`);
        } else if (filter.op === 'eq') {
            const values = Array.isArray(filter.value) ? filter.value : [filter.value];
            for (const val of values) {
                patterns.push(`^${escapeRegex(storagePrefix)}${escapeRegex(authorizedKey)}: ${escapeRegex(String(val))}`);
            }
        }
    }

    return patterns.length > 0 ? [patterns] : [];
}

/**
 * Evaluates if a protocol state matches a set of filters.
 */
export function matchesFilters(state: ProtocolState, filters: readonly QualifiedFilter[], ctx: ProtocolContext): boolean {
    // Support method override via the definition object (used by mocks in tests)
    if ((ctx.def as any).matches) return (ctx.def as any).matches(state, filters);

    for (const filter of filters) {
        // 1. Protocol scope check
        if (filter.protocol !== null && filter.protocol.toLowerCase() !== ctx.def.name.toLowerCase()) {
            continue;
        }

        // 2. Ownership check
        if (!ownsKey(filter.key, ctx) && filter.protocol === null) {
            continue;
        }

        // 3. Authorization check
        const authorizedKey = authorizeKey(filter.key, ctx);
        if (!authorizedKey) return false;

        // 4. Value evaluation
        const actualValues = state.trailers[authorizedKey] || [];
        if (!evaluateFilter(actualValues, filter.op, filter.value)) {
            return false;
        }
    }

    return true;
}

function evaluateFilter(actual: readonly string[], op: FilterOperator, expected: any): boolean {
    const expectedValues = Array.isArray(expected) ? expected : [expected];
    const lowerActual = actual.map(v => v.toLowerCase());

    switch (op) {
        case 'eq':
            return expectedValues.some(ev => lowerActual.includes(String(ev).toLowerCase()));
        case 'has':
            return actual.length > 0;
        default:
            return false;
    }
}

/**
 * Determines if this protocol claims a block of raw trailers.
 */
export function claimsTrailers(rawTrailers: string, ctx: ProtocolContext): boolean {
    // Support method override via the definition object (used by mocks in tests)
    if ((ctx.def as any).claims) return (ctx.def as any).claims(rawTrailers);

    const { def, isRoot } = ctx;
    const lines = rawTrailers.split('\n');

    if (!isRoot) {
        const pattern = new RegExp(`^${escapeRegex(def.namespace)}:`, 'i');
        return lines.some(l => pattern.test(l));
    }

    const idPattern = new RegExp(`^${escapeRegex(def.identityKey)}:`, 'i');
    return lines.some(l => idPattern.test(l));
}
