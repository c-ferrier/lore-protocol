import { TRAILER_UI_KINDS, TRAILER_UI_COLORS } from '../util/constants.js';

export type TrailerUiKind = (typeof TRAILER_UI_KINDS)[number];
export type TrailerUiColor = (typeof TRAILER_UI_COLORS)[number];

export interface ValueDefinition {
  readonly description: string;
}

export interface CustomTrailerDefinition {
  readonly description: string;
  readonly multivalue: boolean;
  readonly validation: 'values' | 'pattern' | 'none';
  readonly values?: Record<string, string | ValueDefinition>;
  readonly pattern?: string;
  readonly required?: boolean;
  readonly directives?: readonly string[];
  /** UI hints for the formatter. */
  readonly ui?: {
    readonly kind?: TrailerUiKind;
    readonly color?: TrailerUiColor;
  };
  /** CLI hints for the commit command. */
  readonly cli?: {
    readonly flag?: string;
    readonly shorthand?: string;
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
   * Strategy for merging values during 'lore squash'.
   * - 'union': List all unique values (default for arrays).
   * - 'rank-min': Pick value with lowest index in 'values'.
   * - 'rank-max': Pick value with highest index in 'values'.
   */
  readonly squash?: 'union' | 'rank-min' | 'rank-max';
  /**
   * Strategy for generating new values (primarily used for identity keys).
   * - 'hex8': Generate a random 8-character hex string (default).
   * - 'uuid': Generate a v4 UUID.
   * - 'none': Do not generate; user must provide.
   */
  readonly generator?: 'hex8' | 'uuid' | 'none';
}

export interface Config {
  readonly protocol: {
    readonly name: string;
    readonly version: string;
  };
  readonly trailers: {
    readonly required: readonly string[];
    readonly custom: readonly string[];
    readonly definitions: Record<string, CustomTrailerDefinition>;
    readonly permissive: boolean;
  };
  readonly validation: {
    readonly strict: boolean;
    readonly maxMessageLines: number;
    readonly intentMaxLength: number;
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
    readonly cache?: boolean;
    readonly queryCache?: boolean;
    readonly queryCachePruneThreshold?: number;
  };
}
