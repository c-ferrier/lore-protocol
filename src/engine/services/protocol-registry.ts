import type { IProtocol } from '../interfaces/protocol.js';
import type { QueryIdentity } from '../types/query.js';
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
  private readonly namespaceMap = new Map<string, IProtocol>();

  /**
   * Register a protocol with the engine.
   * @throws Error if safety rules (e.g. multiple permissive protocols in same namespace) are violated.
   */
  register(protocol: IProtocol): void {
    const name = protocol.name.toLowerCase();
    const ns = protocol.namespace.toLowerCase();

    if (this.protocols.has(name)) {
      throw new ConfigurationError(`Protocol "${protocol.name}" is already registered.`);
    }

    // Safety Rule: Only one permissive protocol allowed per namespace to prevent trailer claiming conflicts
    if (protocol.permissive && this.hasPermissiveProtocolInNamespace(ns)) {
      const existing = this.getPermissiveProtocolInNamespace(ns);
      throw new ConfigurationError(
        `Cannot register permissive protocol "${protocol.name}". ` +
          `A permissive protocol ("${existing?.name}") is already registered for namespace "${protocol.namespace || 'root'}". ` +
          `Only one permissive protocol is allowed per namespace to prevent trailer claiming conflicts.`,
      );
    }

    protocol.setRegistry(this);
    this.protocols.set(name, protocol);
    this.namespaceMap.set(ns, protocol);
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
            const id = protocol.getIdentity(state);
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
    return this.namespaceMap.get('');
  }

  /**
   * Resolves a raw ID string into a Qualified Identity.
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
   */
  getFingerprint(): string {
    const protocols = this.getAll().map(p => `${p.name}@${p.version}`);
    protocols.sort();
    return protocols.join(';');
  }
}
