import type { ProtocolContext } from '../types/protocol-definition.js';

/**
 * Translates a raw key into its canonical, schema-defined case.
 * Pure function: takes key and context, returns canonical key or null.
 */
export function authorizeKey(key: string, ctx: ProtocolContext): string | null {
  const lowerKey = key.toLowerCase();
  
  // 1. Exact match in caseMap (Explicitly Rented/Authorized)
  const canonical = ctx.caseMap.get(lowerKey);
  if (canonical) return canonical;

  // 2. Namespace bucket match (Storage Routing)
  if (ctx.storageNamespace !== '' && lowerKey === ctx.storageNamespace.toLowerCase()) {
      return ctx.storageNamespace;
  }

  // 3. Permissive Fallback (Catch-all for this namespace)
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
    if (ctx.isRoot) return true;
    return key.toLowerCase() === ctx.storageNamespace.toLowerCase();
}

/**
 * Resolves the physical storage key for a logical trailer key.
 */
export function getQualifiedKey(key: string, ctx: ProtocolContext): string {
  const canonical = authorizeKey(key, ctx);
  if (!canonical) return key;

  if (ctx.isRoot) return canonical;
  return `${ctx.storageNamespace}: ${canonical}`;
}
