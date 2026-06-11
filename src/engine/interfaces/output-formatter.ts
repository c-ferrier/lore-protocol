import type { Atom } from '../core/types/domain.js';
import type {
  FormattableConfigResult,
  FormattableDoctorResult,
  FormattableQueryResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableValidationResult,
} from '../core/types/output.js';

export interface ErrorMessage {
  readonly severity: 'error' | 'warning';
  readonly field?: string;
  readonly rule?: string;
  readonly message: string;
}

export interface IOutputFormatter {
  // --- Standard Monolithic Formatters ---
  formatQueryResult(data: FormattableQueryResult): string;
  formatValidationResult(data: FormattableValidationResult): string;
  formatStalenessResult(data: FormattableStalenessResult): string;
  formatTraceResult(data: FormattableTraceResult): string;
  formatDoctorResult(data: FormattableDoctorResult): string;
  formatConfig(data: FormattableConfigResult): string;
  formatSuccess(message: string, data?: Record<string, unknown>): string;
  formatError(code: number, messages: readonly ErrorMessage[]): string;

  // --- Streaming Lifecycle Hooks ---
  formatHeader(target: string, type: string): string;
  formatAtom(atom: Atom, visibleTrailers?: readonly string[] | 'all'): string;
  formatFooter(meta: { total: number; filtered: number; oldest: Date | null; newest: Date | null }): string;
}
