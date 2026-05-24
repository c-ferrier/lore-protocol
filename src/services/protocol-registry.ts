import type { IProtocol } from '../interfaces/protocol.js';

/**
 * Orchestrates multiple decision protocols.
 * Allows the engine to discover and hydrate atoms for any registered protocol.
 * Enforces safety rules for multi-protocol environments.
 */
export class ProtocolRegistry {
  private readonly protocols = new Map<string, IProtocol>();

  /**
   * Register a protocol with the engine.
   * @throws Error if safety rules (e.g. multiple permissive protocols in same namespace) are violated.
   */
  register(protocol: IProtocol): void {
    if (protocol.isPermissive && this.hasPermissiveProtocolInNamespace(protocol.namespace)) {
      const existing = this.getPermissiveProtocolInNamespace(protocol.namespace);
      throw new Error(
        `Cannot register permissive protocol "${protocol.name}". ` +
          `A permissive protocol ("${existing?.name}") is already registered for namespace "${protocol.namespace || 'root'}". ` +
          'Only one permissive protocol is allowed per namespace to prevent trailer claiming conflicts.',
      );
    }

    this.protocols.set(protocol.name.toLowerCase(), protocol);
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
  all(): IProtocol[] {
    return Array.from(this.protocols.values());
  }

  /**
   * Detect which protocols claim a set of raw trailers.
   */
  detect(rawTrailers: string): IProtocol[] {
    return this.all().filter((p) => p.claims(rawTrailers));
  }

  /**
   * Get combined Git discovery arguments for all registered protocols.
   * Uses a single --grep argument with an OR statement to allow safe
   * combination with other filters (like --author) via --all-match.
   */
  getDiscoveryGrep(): string[] {
    const patterns = this.all().map((p) => p.getDiscoveryPattern());
    if (patterns.length === 0) return [];
    
    // Combine patterns using | and wrap in parentheses for safety
    const combined = patterns.map((p) => `(${p})`).join('|');
    return [`--grep=${combined}`];
  }

  /**
   * Returns the protocol registered for the root namespace ("").
   */
  getRoot(): IProtocol | undefined {
    return this.all().find((p) => p.namespace === '');
  }

  private hasPermissiveProtocolInNamespace(namespace: string): boolean {
    return this.all().some((p) => p.isPermissive && p.namespace.toLowerCase() === namespace.toLowerCase());
  }

  private getPermissiveProtocolInNamespace(namespace: string): IProtocol | undefined {
    return this.all().find((p) => p.isPermissive && p.namespace.toLowerCase() === namespace.toLowerCase());
  }
}
