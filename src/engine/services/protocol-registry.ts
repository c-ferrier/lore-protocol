import { getProtocolIdentity } from '../core/logic/identity.js';
import { authorizeKey } from '../core/logic/ownership.js';
import { createProtocolContext, getAuthorizedKeys } from '../core/logic/protocols.js';
import { isValidProtocolIdentity } from '../core/logic/validation.js';
import { type Atom, ProtocolMap } from '../core/types/domain.js';
import type { IIdentityResolver,ProtocolContext, ProtocolDefinition } from '../core/types/protocol-definition.js';
import type { QualifiedFilter, QueryIdentity } from '../core/types/query.js';
import { 
    claimsTrailers, 
    getDiscoveryPatterns, 
    getSearchPatterns} from '../shell/git/protocol-query-adapter.js';
import { ConfigurationError,ProtocolError } from '../util/errors.js';

/**
 * Orchestrates multiple decision protocols using the Strict Isolation Model.
 * 
 * DESIGN: Each namespace (including root "") can have EXACTLY one protocol.
 * This ensures deterministic data ownership and zero ambiguity during discovery.
 * 
 * SRP: Central repository for ProtocolContext data.
 */
export class ProtocolRegistry implements IIdentityResolver {
  private readonly protocols = new ProtocolMap<ProtocolContext>();
  private readonly namespaceMap = new Map<string, ProtocolContext>();

  /**
   * Register a new protocol definition or context.
   * Preserves existing context objects (useful for mocks in tests).
   */
  register(input: ProtocolDefinition | ProtocolContext | { def: ProtocolDefinition }): void {
     const def = (input as any).def || input;
     const ctx = (input as any).caseMap ? (input as ProtocolContext) : createProtocolContext(def);
     
     const name = def.name.toLowerCase();
     const ns = (def.namespace ?? '').toLowerCase();

     if (this.protocols.has(name)) {
       throw new ConfigurationError(`Protocol "${def.name}" is already registered`);
     }

     const existingForNs = this.namespaceMap.get(ns);
     if (existingForNs) {
       const nsDisplay = ns === '' ? 'root' : `"${ns}"`;
       throw new ConfigurationError(
         `Namespace Conflict: Cannot register protocol "${def.name}". ` +
         `Protocol "${existingForNs.def.name}" is already registered for namespace ${nsDisplay}.`
       );
     }

     this.protocols.set(name, ctx);
     this.namespaceMap.set(ns, ctx);
  }

  /**
   * Find a protocol context by name.
   */
  get(name: string): ProtocolContext | undefined {
    return this.protocols.get(name.toLowerCase());
  }

  /**
   * Find a protocol context by its storage namespace.
   */
  getByNamespace(ns: string): ProtocolContext | undefined {
    return this.namespaceMap.get(ns.toLowerCase());
  }

  /**
   * Return all registered protocol contexts.
   */
  getAll(): ProtocolContext[] {
    return Array.from(this.protocols.values());
  }

  /**
   * Gets the primary identity for an atom.
   */
  getIdentity(atom: Atom): string | null {
    const root = this.getRoot();
    if (!root) return null;

    const state = atom.protocols.get(root.name.toLowerCase()) || atom.protocols.get(root.name);
    if (!state) return null;

    return getProtocolIdentity(state, root);
  }

  /**
   * Returns a set of all primary keys reserved by any registered protocol.
   */
  getClaimedKeys(): Set<string> {
    const claimed = new Set<string>();
    for (const ctx of this.getAll()) {
      const ns = ctx.storageNamespace;
      if (ns !== '') {
        claimed.add(ns.toLowerCase());
      } else {
        // Map all authorized keys from the context
        for (const k of getAuthorizedKeys(ctx)) {
          claimed.add(k.toLowerCase());
        }
      }
    }
    return claimed;
  }

  /**
   * Detect which protocols claim a set of raw trailers.
   */
  detect(rawTrailers: string): ProtocolContext[] {
    return this.getAll().filter((ctx) => claimsTrailers(rawTrailers, ctx));
  }

  /**
   * Returns a list of regex patterns for discovery.
   */
  getDiscoveryPatterns(): string[] {
    const patterns: string[] = [];
    for (const ctx of this.getAll()) {
      patterns.push(...getDiscoveryPatterns(ctx));
    }
    return patterns;
  }

  /**
   * Translates structured filters into raw regex patterns.
   */
  getSearchPatterns(filters: readonly QualifiedFilter[]): string[][] {
    const results: string[][] = [];

    for (const filter of filters) {
      const orSet: string[] = [];

      if (filter.protocol) {
        const ctx = this.get(filter.protocol);
        if (ctx) {
          const pPatterns = getSearchPatterns([filter], ctx);
          for (const set of pPatterns) orSet.push(...set);
        }
      } else {
        const target = this.resolveKey(filter.key);
        if (target) {
            const pPatterns = getSearchPatterns([filter], target);
            for (const set of pPatterns) orSet.push(...set);
        }
      }

      if (orSet.length > 0) {
        results.push(Array.from(new Set(orSet)));
      }
    }

    return results;
  }

  /**
   * Resolves a trailer key to its owning protocol context.
   */
  resolveKey(key: string): ProtocolContext | undefined {
    // 1. Check all protocol schemas
    for (const ctx of this.protocols.values()) {
        if (authorizeKey(key, ctx)) return ctx;
    }

    // 2. Check namespace keys
    const nsMatch = this.namespaceMap.get(key.toLowerCase());
    if (nsMatch) return nsMatch;

    // 3. Fallback to Root
    return this.getRoot();
  }

  /**
   * Resolves a raw trailer value into a qualified QueryIdentity.
   * Implementation of IIdentityResolver.
   */
  resolveIdentity(id: string, contextProtocol?: string): QueryIdentity {
    if (id.includes('/')) {
      const [prefix, suffix] = id.split('/', 2);
      const ctx = this.get(prefix) || this.getByNamespace(prefix);
      if (!ctx) {
        throw new ProtocolError(`Unknown protocol prefix: "${prefix}" in identity "${id}"`, 1);
      }
      return { id: suffix, protocol: ctx.name };
    }

    if (contextProtocol) {
      const ctx = this.get(contextProtocol);
      if (ctx && isValidProtocolIdentity(id, ctx.def)) {
        return { id, protocol: ctx.name };
      }
    }

    // Deterministic lookup: who owns this ID format?
    for (const ctx of this.getAll()) {
        if (isValidProtocolIdentity(id, ctx.def)) return { id, protocol: ctx.name };
    }

    const root = this.getRoot();
    if (!root) throw new ProtocolError(`Cannot resolve reference "${id}": no root protocol defined`, 1);
    
    return { id, protocol: root.name };
  }

  /**
   * Generates a stable fingerprint of all registered protocols and their versions.
   */
  getFingerprint(): string {
    const protocols = this.getAll().map(ctx => `${ctx.name}@${ctx.version}`);
    protocols.sort();
    return protocols.join(';');
  }

  /**
   * Returns the "Root" protocol context (global namespace).
   */
  getRoot(): ProtocolContext | undefined {
    return this.namespaceMap.get('');
  }
}
