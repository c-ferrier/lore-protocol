import type {
  FormattableConfigResult,
  FormattableDoctorResult,
  FormattableQueryAtom,
  FormattableQueryFooter,
  FormattableQueryHeader,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableValidationResult,
} from '../core/types/output.js';

export interface ErrorMessage {
  readonly severity: 'error' | 'warning';
  readonly rule?: string;
  readonly field?: string;
  readonly message: string;
}

export interface IOutputFormatter {
  // --- Standard Monolithic Formatters ---
  formatValidationResult(data: FormattableValidationResult): string;
  formatStalenessResult(data: FormattableStalenessResult): string;
  formatTraceResult(data: FormattableTraceResult): string;
  formatDoctorResult(data: FormattableDoctorResult): string;
  formatConfigResult(data: FormattableConfigResult): string;
  formatSuccess(message: string, data?: Record<string, unknown>): string;
  formatError(code: number, messages: readonly ErrorMessage[]): string;

  // --- Streaming Query Lifecycle Hooks ---
  formatQueryHeader(data: FormattableQueryHeader): string;
  formatQueryAtom(data: FormattableQueryAtom): string;
  formatQueryFooter(data: FormattableQueryFooter): string;
}

