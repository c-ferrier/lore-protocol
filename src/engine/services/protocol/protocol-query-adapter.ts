import type { IProtocolQueryAdapter } from '../../interfaces/protocol/protocol-query-adapter.js';
import type { ProtocolState } from '../../types/domain.js';
import type { IProtocol } from '../../interfaces/protocol.js';
import { escapeRegex } from '../../util/regex.js';

/**
 * Implementation of the Protocol Query Adapter capability.
 * Owns discovery patterns and search filtering.
 */
export class ProtocolQueryAdapter implements IProtocolQueryAdapter {
  constructor(private readonly protocol: IProtocol) {}

  getDiscoveryPattern(): string {
    const { namespace, identityKey } = this.protocol;
    if (namespace !== '') {
      // Coarse pass: just find the namespace key at start of line
      return `^${namespace}:`;
    }

    const identityDef = this.protocol.getDefinition(identityKey);
    const pattern = identityDef?.pattern || '.+';
    return `^${identityKey}: ${pattern.replace(/^\^|\$$/g, '')}`;
  }

  getDiscoveryGrep(): string[] {
    return [`--grep=${this.getDiscoveryPattern()}`];
  }

  getSearchGrep(filters: Record<string, string | string[]>): string[] {
    const args: string[] = [];
    const { namespace } = this.protocol;

    for (const [key, value] of Object.entries(filters)) {
      const authorizedKey = this.protocol.authorize(key);
      if (!authorizedKey) continue;

      const values = Array.isArray(value) ? value : [value];
      for (const val of values) {
        if (namespace !== '') {
            // Namespaced search: --grep="^Namespace: Key: value"
            args.push(`--grep=^${namespace}: ${authorizedKey}: ${val}`);
        } else {
            // Root search: --grep="^Key: value"
            args.push(`--grep=^${authorizedKey}: ${val}`);
        }
      }
    }

    return args;
  }

  getIdentityPattern(id: string): string {
    const { namespace, identityKey } = this.protocol;
    if (namespace !== '') {
        return `^${namespace}: ${identityKey}: ${escapeRegex(id)}`;
    }
    return `^${identityKey}: ${escapeRegex(id)}`;
  }

  matches(state: ProtocolState, filters: Record<string, string | string[]>): boolean {
    for (const [key, value] of Object.entries(filters)) {
      const authorizedKey = this.protocol.authorize(key);
      if (!authorizedKey) continue;

      const actualValues = state.trailers[authorizedKey] || [];
      const filterValues = Array.isArray(value) ? value : [value];

      if (actualValues.length === 0) {
        // If we own the key but it has no values in the state, it's a mismatch
        if (this.protocol.owns(key) || this.protocol.authorize(key)) {
           return false;
        }
        continue;
      }

      const matched = filterValues.some((fv) =>
        actualValues.some((av) => av.toLowerCase() === fv.toLowerCase()),
      );

      if (!matched) return false;
    }

    return true;
  }

  claims(rawTrailers: string): boolean {
    const { namespace, identityKey } = this.protocol;
    const pattern = namespace !== ''
        ? new RegExp(`^${namespace}:`, 'i')
        : new RegExp(`^${identityKey}:`, 'i');
    
    return rawTrailers.split('\n').some((line) => pattern.test(line));
  }
}
