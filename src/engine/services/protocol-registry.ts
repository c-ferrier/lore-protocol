import { ProtocolMap, type Atom, type SupersessionStatus } from '../core/types/domain.js';
import type { QualifiedFilter, QueryIdentity } from '../core/types/query.js';
import { ProtocolError, ConfigurationError } from '../util/errors.js';
import {  ActiveProtocol  } from '../core/models/active-protocol.js';
import { ProtocolQueryAdapter } from '../shell/git/protocol-query-adapter.js';

/**
 * Orchestrates multiple decision protocols using the Strict Isolation Model.
 * 
 * DESIGN: Each namespace (including root "") can have EXACTLY one protocol.
 * This ensures deterministic data ownership and zero ambiguity during discovery.
 */
export class ProtocolRegistry {
  private readonly protocols = new ProtocolMap<ActiveProtocol>();
  private readonly namespaceMap = new Map<string, ActiveProtocol>();

  /**
   * Register a protocol with the engine.
   * Enforces: Max 1 protocol per namespace, Max 1 Root protocol.
   /**
    * Register a new protocol.
    */
   register(protocol: ActiveProtocol): void {
     const name = protocol.name.toLowerCase();
     const ns = protocol.storageNamespace.toLowerCase();

     if (this.protocols.has(name)) {
       throw new ConfigurationError(`Protocol "${protocol.name}" is already registered`);
     }

     // Strict Isolation: Max 1 protocol per namespace
     const existingForNs = this.namespaceMap.get(ns);
     if (existingForNs) {
       const nsDisplay = ns === '' ? 'root' : `"${ns}"`;
       throw new ConfigurationError(
         `Namespace Conflict: Cannot register protocol "${protocol.name}". ` +
         `Protocol "${existingForNs.name}" is already registered for namespace ${nsDisplay}.`
       );
     }

     this.protocols.set(name, protocol);
     this.namespaceMap.set(ns, protocol);

     // Backward compatibility for legacy tests that expect registry linkage
     if (typeof (protocol as any).setRegistry === 'function') {
         (protocol as any).setRegistry(this);
     }
   }

   /**
    * Find a protocol by name.
    */
   get(name: string): ActiveProtocol | undefined {
     return this.protocols.get(name.toLowerCase());
   }

   /**
    * Find a protocol by its storage namespace.
    */
   getByNamespace(ns: string): ActiveProtocol | undefined {
       return this.namespaceMap.get(ns.toLowerCase());
   }

  /**
   * Return all registered protocols.
   */
  getAll(): ActiveProtocol[] {
    return Array.from(this.protocols.values());
  }

  /**
   * Gets the primary identity for an atom.
   */
  getIdentity(atom: Atom): string | null {
    const root = this.getRoot();
    if (!root) return null;

    const state = atom.protocols.get(root.name);
    return root.getIdentity(state);
  }

  /**
   * Returns a set of all primary keys reserved by any registered protocol.
   */
  getClaimedKeys(): Set<string> {
    const claimed = new Set<string>();
    for (const p of this.getAll()) {
      const ns = p.storageNamespace;
      if (ns !== '') {
        claimed.add(ns.toLowerCase());
      } else {
        for (const k of p.getAuthorizedKeys()) {
          claimed.add(k.toLowerCase());
        }
      }
    }
    return claimed;
  }

  /**
   * Detect which protocols claim a set of raw trailers.
   */
  detect(rawTrailers: string): ActiveProtocol[] {
    return this.getAll().filter((p) => {
        const adapter = new ProtocolQueryAdapter(p);
        return adapter.claims(rawTrailers);
    });
  }

  /**
   * Returns a list of regex patterns for discovery.
   */
  getDiscoveryPatterns(): string[] {
    const patterns: string[] = [];
    for (const p of this.getAll()) {
      const adapter = new ProtocolQueryAdapter(p);
      patterns.push(...adapter.getDiscoveryPatterns());
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
        const p = this.get(filter.protocol);
        if (p) {
          const adapter = new ProtocolQueryAdapter(p);
          const pPatterns = adapter.getSearchPatterns([filter]);
          for (const set of pPatterns) orSet.push(...set);
        }
      } else {
        const target = this.resolveKey(filter.key);
        if (target) {
            const adapter = new ProtocolQueryAdapter(target);
            const pPatterns = adapter.getSearchPatterns([filter]);
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
   * Resolves a trailer key to its owning protocol.
   */
  resolveKey(key: string): ActiveProtocol | undefined {
    // 1. Check all protocol schemas
    for (const p of this.protocols.values()) {
        if (p.authorize(key)) return p;
    }

    // 2. Check namespace keys
    const nsMatch = this.namespaceMap.get(key.toLowerCase());
    if (nsMatch) return nsMatch;

    // 3. Fallback to Root
    return this.getRoot();
  }

  /**
   * Resolves a raw trailer value into a qualified QueryIdentity.
   */
  resolveIdentity(id: string, contextProtocol?: string): QueryIdentity {
    if (id.includes('/')) {
      const [prefix, suffix] = id.split('/', 2);
      const protocol = this.get(prefix) || this.getByNamespace(prefix);
      if (!protocol) {
        throw new ProtocolError(`Unknown protocol prefix: "${prefix}" in identity "${id}"`, 1);
      }
      return { id: suffix, protocol: protocol.name };
    }

    if (contextProtocol) {
      const protocol = this.get(contextProtocol);
      if (protocol && protocol.isValidIdentity(id)) {
        return { id, protocol: protocol.name };
      }
    }

    // Deterministic lookup: who owns this ID format?
    for (const p of this.getAll()) {
        if (p.isValidIdentity(id)) return { id, protocol: p.name };
    }

    const root = this.getRoot();
    if (!root) throw new ProtocolError(`Cannot resolve reference "${id}": no root protocol defined`, 1);
    
    return { id, protocol: root.name };
  }

  /**
   * Generates a stable fingerprint of all registered protocols and their versions.
   */
  getFingerprint(): string {
    const protocols = this.getAll().map(p => `${p.name}@${p.version}`);
    protocols.sort();
    return protocols.join(';');
  }

  /**
   * Returns the "Root" protocol (global namespace).
   */
  getRoot(): ActiveProtocol | undefined {
    return this.namespaceMap.get('');
  }
}
