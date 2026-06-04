import type { ProtocolContext } from '../types/protocol-definition.js';

/**
 * Returns a fully qualified key for UI or error reporting.
 * Namespaced: "Namespace:Key"
 * Root: "Key"
 */
export function getQualifiedKey(key: string, ctx: ProtocolContext): string {
  if (ctx.isRoot) return key;
  return key === ctx.def.namespace ? key : `${ctx.def.namespace}:${key}`;
}

/**
 * Checks if a top-level key matches the protocol's persistence bucket.
 * E.g. for Jira protocol, matches "Jira".
 */
export function isBucketOwner(key: string, ctx: ProtocolContext): boolean {
  return !ctx.isRoot && key.toLowerCase() === ctx.def.namespace.toLowerCase();
}

/**
 * Defines definitively what this protocol "owns" at the TOP LEVEL of the git log.
 * STRICT SEGMENTATION: 
 * - Namespaced protocols ONLY own their literal namespace key.
 * - Root protocols own their identityKey and everything in their schema.
 */
export function ownsKey(key: string, ctx: ProtocolContext): boolean {
  const lowerKey = key.toLowerCase();
  
  if (isBucketOwner(lowerKey, ctx)) return true;
  if (!ctx.isRoot) return false;
  
  // Root Context: Global Landlord
  if (lowerKey === ctx.def.identityKey.toLowerCase()) return true;
  if (lowerKey === ctx.def.name.toLowerCase()) return true;
  
  // Optimized check using pre-computed caseMap
  return ctx.caseMap.has(lowerKey);
}

/**
 * Translates a raw key into its canonical, schema-defined case.
 * If the key is not in the schema:
 * - Root + Permissive: Returns the key as-is (allowed guest).
 * - Otherwise: Returns null (unauthorized).
 */
export function authorizeKey(key: string, ctx: ProtocolContext): string | null {
  const lowerKey = key.toLowerCase();
  const canonical = ctx.caseMap.get(lowerKey);
  if (canonical) return canonical;
  
  return (ctx.isRoot && ctx.def.permissive) ? key : null;
}
