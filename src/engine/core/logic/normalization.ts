import type { ProtocolState } from '../types/domain.js';
import type { ProtocolContext } from '../types/protocol-definition.js';
import { authorizeKey, isBucketOwner } from './ownership.js';

/**
 * Normalizes trailers using the Strict Segmented Waterfall.
 * Pure logic -- consumes ProtocolContext and raw trailer map.
 */
export function normalizeTrailers(
    rawMap: Record<string, readonly string[]>, 
    ctx: ProtocolContext, 
    claimedKeys?: Set<string>
): ProtocolState {
    const normalized: Record<string, string[]> = {};
    const unauthorized: Record<string, string[]> = {};
    const lowerClaimed = new Set(Array.from(claimedKeys || []).map(k => k.toLowerCase()));

    for (const [key, values] of Object.entries(rawMap)) {
      const lowerKey = key.toLowerCase();

      // CASE 1: Namespaced Bucket
      // Only namespaced protocols parse internal key-value pairs from a bucket.
      if (!ctx.isRoot && isBucketOwner(lowerKey, ctx)) {
        for (const nestedRaw of values) {
          const match = nestedRaw.match(/^([A-Za-z0-9][A-Za-z0-9-]*):\s*(.*)$/);
          if (!match) {
            unauthorized['invalid-format'] = [...(unauthorized['invalid-format'] || []), nestedRaw];
            continue;
          }
          const innerKey = match[1];
          const innerValue = match[2];
          const lowerInnerKey = innerKey.toLowerCase();
          
          const authorizedKey = ctx.caseMap.get(lowerInnerKey);
          if (authorizedKey) {
            // Rule: Strict claim within namespace
            normalized[authorizedKey] = [...(normalized[authorizedKey] || []), innerValue];
          } else if (ctx.permissive) {
            // Rule: Permissive fallback for this namespace
            normalized[innerKey] = [...(normalized[innerKey] || []), innerValue];
          } else {
            // Strictly unauthorized within our bucket
            unauthorized[innerKey] = [...(unauthorized[innerKey] || []), innerValue];
          }
        }
        continue;
      }

      // CASE 2: Global/Root Context
      if (!ctx.isRoot) {
          // Check for "Namespace: Key" format at top level
          const prefix = `${ctx.storageNamespace.toLowerCase()}: `;
          if (lowerKey.startsWith(prefix)) {
              const innerKey = key.substring(prefix.length).trim();
              const lowerInnerKey = innerKey.toLowerCase();
              const authorizedKey = ctx.caseMap.get(lowerInnerKey);
              
              if (authorizedKey) {
                  normalized[authorizedKey] = [...(normalized[authorizedKey] || []), ...values];
              } else if (ctx.permissive) {
                  normalized[innerKey] = [...(normalized[innerKey] || []), ...values];
              } else {
                  unauthorized[innerKey] = [...(unauthorized[innerKey] || []), ...values];
              }
          } else {
              // If it's a namespaced protocol but the key DOES NOT start with our namespace prefix,
              // we ignore it (it belongs to the root or another namespace).
          }
          continue;
      }

      // If someone ELSE owns this key (another protocol's namespace), we MUST ignore it.
      // A key is "owned by others" if it's in claimedKeys but NOT in our explicit schema/namespace.
      const isExplicitlyOurs = ctx.caseMap.has(lowerKey) || (ctx.storageNamespace !== '' && lowerKey === ctx.storageNamespace.toLowerCase());
      if (lowerClaimed.has(lowerKey) && !isExplicitlyOurs) {
          continue;
      }

      // Root Sovereignty & Permissive Landlord logic
      const authKey = authorizeKey(key, ctx);
      if (authKey) {
          const inSchema = ctx.caseMap.has(lowerKey);
          if (inSchema || ctx.permissive) {
            normalized[authKey] = [...(normalized[authKey] || []), ...values];
            continue;
          }
      }

      // Root Catch-all (Rule: if permissive and unclaimed)
      if (ctx.permissive) {
          normalized[key] = [...(normalized[key] || []), ...values];
          continue;
      }

      // Root Strictly Unauthorized (typos or orphaned namespaces in strict mode)
      unauthorized[key] = [...(unauthorized[key] || []), ...values];
    }

    return { trailers: normalized, unauthorized };
}
