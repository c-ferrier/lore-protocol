import type { Atom, SupersessionStatus, StaleSignal } from './domain.js';
import type { QueryResult } from './query.js';
import type { ValueDefinition, TrailerUiKind, TrailerUiColor } from './config.js';

export interface FormattableQueryResult {
  readonly result: QueryResult;
  readonly supersessionMap: ReadonlyMap<string, SupersessionStatus>;
  readonly visibleTrailers: readonly string[] | 'all';
}

export interface FormattableValidationResult {
  readonly valid: boolean;
  readonly summary: { errors: number; warnings: number; commitsChecked: number };
  readonly results: readonly CommitValidationResult[];
}

export interface CommitValidationResult {
  readonly commit: string;
  readonly id: string | null;
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
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

export interface StaleReason {
  readonly signal: StaleSignal;
  readonly description: string;
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
  readonly relationship: 'Related' | 'Supersedes' | 'Depends-on';
  readonly targetAtom: Atom | null;
}

export interface FormattableDoctorResult {
  readonly checks: readonly DoctorCheck[];
  readonly summary: { errors: number; warnings: number; info: number };
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
  readonly validation: 'values' | 'pattern' | 'none';
  readonly values?: Record<string, ValueDefinition>;
  readonly pattern?: string;
  readonly required?: boolean;
  readonly isCore: boolean;
  readonly directives: readonly string[];
  readonly ui?: {
    readonly kind?: TrailerUiKind;
    readonly color?: TrailerUiColor;
  };
}

export interface FormattableConfigResult {
  readonly version: string;
  readonly permissive: boolean;
  readonly trailers: Record<string, FormattableTrailerDefinition>;
  readonly filters: {
    readonly showCore: boolean;
    readonly showCustom: boolean;
  };
}
