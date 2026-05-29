import type { IProtocol } from '../interfaces/protocol.js';
import type { QueryIdentity } from '../types/query.js';
import { ProtocolError } from '../../util/errors.js';

/**
 * Orchestrates multiple decision protocols.
 * Allows the engine to discover and hydrate atoms for any registered protocol.
 * Enforces safety rules for multi-protocol environments.
 */
export class ProtocolRegistry {
  private readonly protocols = new Map<string, IProtocol>();
  private readonly namespaceMap = new Map<string, IProtocol>();

  /**
   * Register a protocol with the engine.
   * @throws Error if safety rules (e.g. multiple permissive protocols in same namespace) are violated.
   */
  register(protocol: IProtocol): void {
    if (protocol.permissive && this.hasPermissiveProtocolInNamespace(protocol.namespace)) {
      const existing = this.getPermissiveProtocolInNamespace(protocol.namespace);
      throw new Error(
        `Cannot register permissive protocol "${protocol.name}". ` +
          `A permissive protocol ("${existing?.name}") is already registered for namespace "${protocol.namespace || 'root'}". ` +
          `Only one permissive protocol is allowed per namespace to prevent trailer claiming conflicts.`,
      );
    }

    protocol.setRegistry(this);
    this.protocols.set(protocol.name.toLowerCase(), protocol);
    this.namespaceMap.set(protocol.namespace.toLowerCase(), protocol);
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
   */
  getIdentity(atom: any): string | null {
    for (const protocol of this.protocols.values()) {
        const state = atom.protocols.get(protocol.name.toLowerCase());
        if (state) {
            const id = protocol.getIdentity(state.trailers);
            if (id) return id;
        }
    }
    return null;
  }

  /**
   * Returns a set of all primary keys (namespaces or root authorized keys) 
   * that are reserved by any registered protocol.
   */
  getClaimedKeys(): Set<string> {
    const claimed = new Set<string>();
    for (const p of this.getAll()) {
      if (p.namespace !== '') {
        // Namespaced protocols claim their namespace key
        claimed.add(p.namespace.toLowerCase());
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
   * Get combined Git discovery arguments for all registered protocols.
   * Uses a single --grep argument with an OR statement to allow safe
   * combination with other filters (like --author) via --all-match.
   */
  getDiscoveryGrep(): string[] {
    const patterns = this.getAll().map((p) => p.getDiscoveryPattern());
    if (patterns.length === 0) return [];
    
    if (patterns.length === 1) {
      return [`--grep=${patterns[0]}`];
    }
    
    // Combine multiple patterns using | and wrap in parentheses for safety
    const combined = patterns.map(p => `(${p})`).join('|');
    return [`--grep=${combined}`];
  }

  /**
   * Translates generic filters into specific Git grep arguments across all protocols.
   */
  getSearchGrep(options: { has?: string | null; filters?: Record<string, string | string[]> }): string[] {
    const args: string[] = [];

    if (options.has) {
      // Find all protocols that own or authorize this key
      const patterns: string[] = [];
      for (const p of this.getAll()) {
        const authorizedKey = p.authorize(options.has);
        if (authorizedKey) {
          const prefix = p.namespace ? `${p.namespace}: ` : '';
          patterns.push(`(^${prefix}${authorizedKey}: )`);
        }
      }
      if (patterns.length > 0) {
        args.push(`--grep=${patterns.join('|')}`);
      }
    }

    if (options.filters) {
      for (const p of this.getAll()) {
        const pArgs = p.getSearchGrep(options.filters);
        args.push(...pArgs);
      }
    }

    return args;
  }

  /**
   * Returns the protocol registered for the root namespace ("").
   */
  getRoot(): IProtocol | undefined {
    return this.getAll().find((p) => p.namespace === '');
  }

  /**
   * Resolves a raw ID string into a Qualified Identity.
   * Enforces strict ambiguity rules.
   * 
   * @param id The raw ID string (e.g. "123" or "alpha/123")
   * @param contextProtocol Optional default protocol name if not prefixed
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
      if (protocol) {
        return { id, protocol: protocol.name.toLowerCase() };
      }
    }

    // Ambiguity Detection
    const candidates = this.getAll().filter(p => p.isValidIdentity(id));
    if (candidates.length > 1) {
      const names = candidates.map(p => p.name).join(', ');
      throw new ProtocolError(
        `Ambiguous ID "${id}" matches multiple protocols: ${names}. ` +
        `Please use a prefix (e.g. "${candidates[0].name.toLowerCase()}/${id}") to disambiguate.`,
        1
      );
    }

    return { 
      id, 
      protocol: candidates.length === 1 ? candidates[0].name.toLowerCase() : undefined 
    };
  }

  private hasPermissiveProtocolInNamespace(namespace: string): boolean {
    return this.getAll().some((p) => p.permissive && p.namespace.toLowerCase() === namespace.toLowerCase());
  }

  private getPermissiveProtocolInNamespace(namespace: string): IProtocol | undefined {
    return this.getAll().find((p) => p.permissive && p.namespace.toLowerCase() === namespace.toLowerCase());
  }

  /**
   * Generates a stable fingerprint of all registered protocols and their versions.
   * Used to invalidate caches when the protocol registry changes.
   */
  getFingerprint(): string {
    const protocols = this.getAll().map(p => `${p.name}@${p.version}`);
    protocols.sort();
    return protocols.join(';');
  }
}
