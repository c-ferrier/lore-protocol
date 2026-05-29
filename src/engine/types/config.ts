import { TRAILER_UI_KINDS, TRAILER_UI_COLORS } from '../util/constants.js';

export type TrailerUiKind = (typeof TRAILER_UI_KINDS)[number];
export type TrailerUiColor = (typeof TRAILER_UI_COLORS)[number];

export interface ValueDefinition {
  readonly description: string;
}

/**
 * Definition of a single trailer type within a protocol.
 */
export interface TrailerDefinition {
  readonly description: string;
  readonly multivalue: boolean;
  readonly validation: 'values' | 'pattern' | 'reference' | 'none';
  readonly values?: Record<string, string | ValueDefinition>;
  readonly pattern?: string;
  readonly required?: boolean;
  /** 
   * If true, this trailer is part of the core protocol schema.
   * If false or undefined, it is a custom trailer defined in config.
   */
  readonly isCore?: boolean;
  readonly directives?: readonly string[];
  /** UI hints for the formatter. */
  readonly ui?: {
    readonly kind?: TrailerUiKind;
    readonly color?: TrailerUiColor;
  };
  /** CLI hints for the commit command. */
  readonly cli?: {
    readonly flag?: string;
  };
  /** Interactive prompt hints. */
  readonly prompt?: {
    readonly confirm?: string;
    readonly input?: string;
    readonly choice?: string;
    /**
     * Relative sort weight for interactive prompts.
     * Core trailers use 100-200. Custom trailers default to 1000.
     */
    readonly order?: number;
  };
  /**
   * Strategy for merging values during 'atom squash'.
   */
  readonly squash?: 'union' | 'rank-min' | 'rank-max';
  /**
   * Strategy for generating new values (primarily used for identity keys).
   */
  readonly generator?: 'hex8' | 'uuid' | 'none';
  /**
   * If true (default for references), allows this trailer to link to identities 
   * in other protocols using the 'protocol/id' syntax.
   */
  readonly crossProtocol?: boolean;
}

/**
 * Host-level settings for the Decision Atom Engine.
 * Stored in .atom/config.toml
 */
export interface EngineConfig {
  readonly validation: {
    readonly maxMessageLines: number;
    readonly subjectMaxLength: number;
  };
  readonly stale: {
    readonly olderThan: string;
    readonly driftThreshold: number;
  };
  readonly output: {
    readonly defaultFormat: 'text' | 'json';
  };
  readonly follow: {
    readonly maxDepth: number;
  };
  readonly cli: {
    readonly updateCheck: boolean;
    readonly cache: boolean;
    readonly queryCache: boolean;
    readonly queryCachePruneThreshold: number;
  };
}

/**
 * Formal schema for Engine-level configuration gaps.
 */
export const ENGINE_CONFIG_SCHEMA: Record<string, string[]> = {
  validation: ['maxMessageLines', 'subjectMaxLength'],
  stale: ['olderThan', 'driftThreshold'],
  output: ['defaultFormat'],
  follow: ['maxDepth'],
  cli: ['updateCheck', 'cache', 'queryCache', 'queryCachePruneThreshold'],
};

/**
 * Runtime configuration for a specific protocol instance.
 * Merges static ProtocolDefinition with user overrides.
 */
export interface ProtocolConfig {
  readonly version: string;
  readonly strict: boolean;
  readonly permissive: boolean;
  readonly trailers: {
    readonly definitions: Record<string, TrailerDefinition>;
  };
}
