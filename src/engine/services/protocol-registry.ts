import type { IProtocol } from '../interfaces/protocol.js';
import type { QueryIdentity, QualifiedFilter } from '../types/query.js';
import { ProtocolError, ConfigurationError } from '../util/errors.js';

/**
 * Orchestrates multiple decision protocols.
 * Allows the engine to discover and hydrate atoms for any registered protocol.
 * Enforces safety rules for multi-protocol environments.
 * 
 * SOLID: SRP -- focused purely on protocol lookups and collision prevention.
 */
export class ProtocolRegistry {
  private readonly protocols = new Map<string, IProtocol>();

  /**
   * Register a protocol with the engine.
   * @throws Error if safety rules (e.g. multiple permissive protocols in same namespace) are violated.
   */
  register(protocol: IProtocol): void {
    const name = protocol.name.toLowerCase();
    const ns = protocol.getStorageNamespace().toLowerCase();

    if (this.protocols.has(name)) {
      throw new ConfigurationError(`Protocol "${protocol.name}" is already registered`);
    }

    // Safety Rule: Only one permissive protocol allowed per namespace to prevent trailer claiming conflicts
    if (protocol.permissive) {
      for (const p of this.protocols.values()) {
        const pNs = p.getStorageNamespace().toLowerCase();
        if (pNs === ns && p.permissive) {
          throw new ConfigurationError(
            `Cannot register permissive protocol "${protocol.name}". ` +
            `A permissive protocol ("${p.name}") is already registered for namespace "${p.getStorageNamespace() || 'root'}". ` +
            `Only one permissive protocol is allowed per namespace to prevent trailer claiming conflicts.`
          );
        }
      }
    }

    // Link the protocol to this registry for cross-protocol lookups
    protocol.setRegistry(this);
    this.protocols.set(name, protocol);
  }

  /**
   * Find a protocol by name (case-insensitive).
   */
  get(name: string): IProtocol | undefined {
    return this.protocols.get(name.toLowerCase());
  }

  /**
   * Return all registered protocols.
   */
  getAll(): IProtocol[] {
    return Array.from(this.protocols.values());
  }

  /** Alias for getAll() */
  all(): IProtocol[] {
    return this.getAll();
  }

  /**
   * Gets the primary identity for an atom by asking the protocol that claimed it.
   * Prefers the Root protocol's identity if available.
   */
  getIdentity(atom: any): string | null {
    const primary = this.getRoot() || this.getAll()[0];
    if (!primary) return null;

    const state = atom.protocols.get(primary.name.toLowerCase());
    return primary.getIdentity(state);
  }

  /**
   * Returns a set of all primary keys (namespaces or root authorized keys) 
   * that are reserved by any registered protocol.
   */
  getClaimedKeys(): Set<string> {
    const claimed = new Set<string>();
    for (const p of this.getAll()) {
      const ns = p.getStorageNamespace();
      if (ns !== '') {
        // Namespaced protocols claim their namespace key
        claimed.add(ns.toLowerCase());
      } else {
        // Root protocols claim their authorized keys
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
  detect(rawTrailers: string): IProtocol[] {
    return this.getAll().filter((p) => p.claims(rawTrailers));
  }

  /**
   * Returns a list of regex patterns for discovery. All returned patterns 
   * should be OR'ed together.
   */
  getDiscoveryPatterns(): string[] {
    const patterns: string[] = [];
    for (const p of this.getAll()) {
      patterns.push(...p.getDiscoveryPatterns());
    }
    return patterns;
  }

  /**
   * Translates structured filters into nested raw regex patterns.
   * Returns an array of arrays, where top level is AND and inner is OR.
   */
  getSearchPatterns(filters: readonly QualifiedFilter[]): string[][] {
    const results: string[][] = [];

    for (const filter of filters) {
      const orSet: string[] = [];

      // A. Explicitly Qualified Filter (e.g. project/status)
      if (filter.protocol) {
        const p = this.get(filter.protocol);
        if (p) {
          const pPatterns = p.getSearchPatterns([filter]);
          for (const set of pPatterns) orSet.push(...set);
        }
      } 
      // B. Unqualified Filter (e.g. status) - Strict Disambiguation
      else {
        const target = this.resolveKey(filter.key);
        if (target) {
            const pPatterns = target.getSearchPatterns([filter]);
            for (const set of pPatterns) orSet.push(...set);
        } else {
            // Orphan fallback: try all protocols if no one owns it (legacy discovery support)
            for (const p of this.getAll()) {
              const pPatterns = p.getSearchPatterns([filter]);
              for (const set of pPatterns) orSet.push(...set);
            }
        }
      }

      if (orSet.length > 0) {
        // Dedup for safety (in case multiple protocols generate identical patterns)
        results.push(Array.from(new Set(orSet)));
      }
    }

    return results;
  }

  /**
   * Resolves an unqualified trailer key to its owning protocol.
   * Priority:
   * 1. Unique Schema Owner (matches authorized keys)
   * 2. Host Protocol Fallback (if permissive and no one else claims)
   * 
   * @throws ProtocolError if multiple protocols claim the key.
   */
  resolveKey(key: string): IProtocol | undefined {
    const candidates = this.getAll().filter(p => {
        const authorized = p.authorize(key);
        return authorized && authorized.toLowerCase() === key.toLowerCase();
    });
    
    if (candidates.length > 1) {
      const names = candidates.map(p => p.name).join(', ');
      throw new ProtocolError(
        `Ambiguous key "${key}" is owned by multiple protocols: ${names}. ` +
        `Please use a prefix (e.g. "${candidates[0].name.toLowerCase()}/${key}") to disambiguate.`,
        1
      );
    }

    if (candidates.length === 1) {
        return candidates[0];
    }

    // Fallback: If no one owns it, route to the host protocol if it is permissive
    const root = this.getRoot();
    if (root?.permissive) {
        return root;
    }

    return undefined;
  }

  /**
   * Resolves a raw trailer value into a qualified QueryIdentity.
   * Format support: "protocol/id" or just "id".
   * Unqualified IDs are resolved by checking context and scanning for ambiguity.
   */
  resolveIdentity(id: string, contextProtocol?: string): QueryIdentity {
    if (id.includes('/')) {
      const [prefix, suffix] = id.split('/', 2);
      const protocol = this.get(prefix);
      if (!protocol) {
        throw new ProtocolError(`Unknown protocol prefix: "${prefix}" in identity "${id}"`, 1);
      }
      return { id: suffix, protocol: protocol.name.toLowerCase() };
    }

    if (contextProtocol) {
      const protocol = this.get(contextProtocol);
      if (protocol && protocol.isValidIdentity(id)) {
        return { id, protocol: protocol.name.toLowerCase() };
      }
    }

    // Ambiguity Detection: find all protocols that recognize this ID format
    const candidates = this.getAll().filter(p => p.isValidIdentity(id));
    
    if (candidates.length > 1) {
      const names = candidates.map(p => p.name).join(', ');
      throw new ProtocolError(
        `Ambiguous ID "${id}" matches multiple protocols: ${names}. ` +
        `Please use a prefix (e.g. "${candidates[0].name.toLowerCase()}/${id}") to disambiguate.`,
        1
      );
    }

    if (candidates.length === 1) {
        return { id, protocol: candidates[0].name.toLowerCase() };
    }

    // Fallback to root protocol if no candidates match (validation will catch format issues later)
    const root = this.getRoot();
    if (!root) {
        throw new ProtocolError(`Cannot resolve reference "${id}": no root protocol defined`, 1);
    }
    return { id, protocol: root.name.toLowerCase() };
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
   * Rule: If exactly 1 protocol is in the root namespace, it is the root.
   * If multiple exist, the one that is permissive=true is the root.
   */
  getRoot(): IProtocol | undefined {
    const candidates = this.getAll().filter(p => p.getStorageNamespace() === '');
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];
    return candidates.find(p => p.permissive);
  }
}
