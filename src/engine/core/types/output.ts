import type { Atom, StaleReason } from './domain.js';
import type { QueryMeta,QueryResult } from './query.js';

export type { QueryMeta,QueryResult };
import type { TrailerUiColor,TrailerUiKind, ValueDefinition } from './config.js';

export interface FormattableQueryResult {
  readonly result: QueryResult;
  readonly visibleTrailers: readonly string[] | 'all';
}

export interface FormattableValidationResult {
  readonly valid: boolean;
  readonly summary: { errors: number; warnings: number; commitsChecked: number };
  readonly results: readonly CommitValidationResult[];
}

export interface CommitValidationResult {
  readonly commit: string;
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly identities: Record<string, string>;
}

export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly rule: string;
  readonly field?: string;
  readonly message: string;
}

export interface FormattableStalenessResult {
  readonly atoms: readonly StaleAtomReport[];
}

export interface StaleAtomReport {
  readonly atom: Atom;
  readonly reasons: readonly StaleReason[];
}

export interface FormattableTraceResult {
  readonly root: Atom;
  readonly edges: readonly TraceEdge[];
}

export interface TraceEdge {
  readonly from: string;
  readonly to: string;
  readonly relationship: string;
  readonly targetAtom: Atom | null;
}

export interface FormattableDoctorResult {
  readonly status: 'healthy' | 'unhealthy';
  readonly checks: readonly DoctorCheck[];
  readonly summary: { 
      total: number;
      errors: number; 
      warnings: number; 
      info: number 
  };
}

export interface DoctorCheck {
  readonly name: string;
  readonly status: 'ok' | 'error' | 'warning' | 'info';
  readonly message: string;
  readonly details: readonly string[];
}

/** New additive types for the config command */

export interface FormattableTrailerDefinition {
  readonly description: string;
  readonly multivalue: boolean;
  readonly validation: 'values' | 'pattern' | 'reference' | 'none';
  readonly values?: Record<string, ValueDefinition>;
  readonly pattern?: string;
  readonly required?: boolean;
  readonly isCore: boolean;
  readonly crossProtocol?: boolean;
  readonly directives: readonly string[];
  readonly ui?: {
    readonly kind?: TrailerUiKind;
    readonly color?: TrailerUiColor;
  };
}

export interface FormattableProtocolConfig {
  readonly name: string;
  readonly version: string;
  readonly namespace: string;
  readonly permissive: boolean;
  readonly trailers: Record<string, FormattableTrailerDefinition>;
}

export interface FormattableConfigResult {
  readonly engineVersion: string;
  readonly protocols: readonly FormattableProtocolConfig[];
}
