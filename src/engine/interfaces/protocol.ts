import type { ProtocolState, Atom, SupersessionStatus, StaleReason, Trailers } from '../types/domain.js';
import type { FormattableTrailerDefinition, ValidationIssue } from '../types/output.js';
import type { TrailerDefinition, TrailerUiKind, TrailerUiColor } from '../types/config.js';
import type { ProtocolRegistry } from '../services/protocol-registry.js';
import type { IProtocolSchema } from './protocol/protocol-schema.js';
import type { IProtocolInterpreter } from './protocol/protocol-interpreter.js';
import type { IProtocolValidator } from './protocol/protocol-validator.js';
import type { IProtocolQueryAdapter } from './protocol/protocol-query-adapter.js';

/**
 * Hydrated trailer definition for runtime use in the engine.
 * Combines the base schema with canonical naming context.
 */
export type ActiveTrailer = TrailerDefinition & {
  readonly key: string;
};

/**
 * Interface for a decision protocol (e.g., Mock, Fred).
 * Defines the semantics, identity, and discovery rules for a specific protocol.
 * 
 * DESIGN: This is a Facade interface that combines multiple capability modules.
 */
export interface IProtocol extends 
  IProtocolSchema, 
  IProtocolInterpreter, 
  IProtocolValidator, 
  IProtocolQueryAdapter 
{
  readonly name: string;
  readonly version: string;
  readonly strict: boolean;
  readonly permissive: boolean;
  readonly identityKey: string;

  /**
   * The namespace this protocol operates in.
   * Empty string "" indicates the Root namespace (e.g., Mock).
   * Explicitly namespaced trailers use the format: "Namespace: Key: value".
   */
  readonly namespace: string;

  /**
   * Links this protocol to a registry for cross-protocol resolution.
   */
  setRegistry(registry: ProtocolRegistry): void;
}
