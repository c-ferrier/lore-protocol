import type { ProtocolContext } from '../types/protocol-definition.js';
import { escapeRegex } from '../../util/regex.js';

/**
 * Translates a raw key into its canonical, schema-defined case.
 * Pure function: takes key and context, returns canonical key or null.
 */
export function authorizeKey(key: string, ctx: ProtocolContext): string | null {
  // Support method override via the definition object (used by mocks in tests)
  if ((ctx.def as any).authorize) return (ctx.def as any).authorize(key);

  const lowerKey = key.toLowerCase();
  
  // 1. Exact match in caseMap (canonical trailers)
  const canonical = ctx.caseMap.get(lowerKey);
  if (canonical) return canonical;

  // 2. Namespace bucket match
  if (ctx.storageNamespace !== '' && lowerKey === ctx.storageNamespace.toLowerCase()) {
      return ctx.storageNamespace;
  }

  // 3. Permissive fallback
  if (ctx.permissive) {
      return key;
  }

  return null;
}

/**
 * Determines if a protocol "owns" a trailer key.
 * Pure logic: check if key is authorized by schema or matches namespace.
 */
export function ownsKey(key: string, ctx: ProtocolContext): boolean {
    // Support method override via the definition object (used by mocks in tests)
    if ((ctx.def as any).owns) return (ctx.def as any).owns(key);

    // RULE: Namespaced protocols ONLY own their bucket name at the top level.
    if (!ctx.isRoot) {
        return ctx.storageNamespace !== '' && key.toLowerCase() === ctx.storageNamespace.toLowerCase();
    }

    // RULE: Root protocol owns anything it authorizes (including any key in permissive mode).
    if (authorizeKey(key, ctx)) return true;
    
    return false;
}

/**
 * Determines if a protocol is the "Bucket Owner" for a key.
 * Used for namespaced storage routing.
 */
export function isBucketOwner(key: string, ctx: ProtocolContext): boolean {
    // Support method override via the definition object (used by mocks in tests)
    if ((ctx.def as any).isBucketOwner) return (ctx.def as any).isBucketOwner(key);

    if (ctx.isRoot) return true;
    return key.toLowerCase() === ctx.storageNamespace.toLowerCase();
}

/**
 * Resolves the physical storage key for a logical trailer key.
 */
export function getQualifiedKey(key: string, ctx: ProtocolContext): string {
  // Support method override via the definition object (used by mocks in tests)
  if ((ctx.def as any).getQualifiedKey) return (ctx.def as any).getQualifiedKey(key);

  const canonical = authorizeKey(key, ctx);
  if (!canonical) return key;

  if (ctx.isRoot) return canonical;
  return `${ctx.storageNamespace}: ${canonical}`;
}
