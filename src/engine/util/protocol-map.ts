/** Logical identifier for a protocol (e.g. 'lore', 'project') */
export type ProtocolName = string;

/**
 * A Map that automatically normalizes ProtocolName keys to lowercase.
 * 
 * DESIGN: This encapsulates the engine's case-insensitivity rules for protocol identity.
 * It prevents casing mismatches (e.g. 'Mock' vs 'mock') from causing logic errors.
 */
export class ProtocolMap<V> extends Map<ProtocolName, V> {
  constructor(entries?: readonly (readonly [ProtocolName, V])[] | null) {
    if (entries) {
      super(entries.map(([key, value]) => [key.toLowerCase(), value] as const));
    } else {
      super();
    }
  }

  override get(key: ProtocolName): V | undefined {
    return super.get(key.toLowerCase());
  }
  override set(key: ProtocolName, value: V): this {
    return super.set(key.toLowerCase(), value);
  }
  override has(key: ProtocolName): boolean {
    return super.has(key.toLowerCase());
  }
  override delete(key: ProtocolName): boolean {
    return super.delete(key.toLowerCase());
  }
}
