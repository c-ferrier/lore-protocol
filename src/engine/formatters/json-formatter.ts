import type { IOutputFormatter, ErrorMessage } from '../interfaces/output-formatter.js';
import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
  FormattableConfigResult,
} from '../core/types/output.js';
import type { Atom, ProtocolState } from '../core/types/domain.js';
import type { ProtocolRegistry } from '../services/protocol-registry.js';
import { getProtocolIdentity } from '../core/logic/identity.js';

/**
 * Strategy implementation for JSON output.
 * Produces machine-readable structured data.
 *
 * SOLID: SRP -- only responsible for JSON formatting.
 */
export class JsonFormatter implements IOutputFormatter {
  constructor(protected readonly protocolRegistry: ProtocolRegistry) {}

  /**
   * Returns the key name for the subject field in the output JSON.
   * Can be overridden by subclasses to provide specialized branding (e.g. 'intent').
   */
  protected getSubjectKey(): string {
    return 'subject';
  }

  formatQueryResult(data: FormattableQueryResult): string {
    const { result, visibleTrailers } = data;
    const rootProtocol = this.protocolRegistry.getRoot() || this.protocolRegistry.getAll()[0];
    const subjectKey = this.getSubjectKey();

    const results = result.atoms.map((atom) => {
      const primaryState = rootProtocol ? atom.protocols.get(rootProtocol.def.name.toLowerCase()) || atom.protocols.get(rootProtocol.def.name) : null;

      return {
        commit: atom.commitHash,
        date: atom.date.toISOString(),
        author: atom.author,
        [subjectKey]: atom.subject,
        body: atom.body,
        protocols: this.serializeProtocols(atom, visibleTrailers),
        files_changed: [...atom.filesChanged],
        superseded: primaryState?.supersession?.superseded ?? false,
        superseded_by: primaryState?.supersession?.supersededBy || [],
      };
    });

    return JSON.stringify(
      {
        version: '1.0',
        command: result.command,
        target: result.target,
        target_type: result.targetType,
        meta: {
          total_atoms: result.meta.totalAtoms,
          filtered_atoms: result.meta.filteredAtoms,
          oldest: result.meta.oldest?.toISOString() ?? null,
          newest: result.meta.newest?.toISOString() ?? null,
        },
        results,
      },
      null,
      2,
    );
  }

  formatValidationResult(data: FormattableValidationResult): string {
    return JSON.stringify(
      {
        version: '1.0',
        valid: data.valid,
        summary: {
          errors: data.summary.errors,
          warnings: data.summary.warnings,
          commits_checked: data.summary.commitsChecked,
        },
        results: data.results.map((r) => ({
          commit: r.commit,
          id: r.id,
          valid: r.valid,
          issues: r.issues.map((issue) => ({
            severity: issue.severity,
            rule: issue.rule,
            message: issue.message,
          })),
        })),
      },
      null,
      2,
    );
  }

  formatStalenessResult(data: FormattableStalenessResult): string {
    const subjectKey = this.getSubjectKey();

    return JSON.stringify(
      {
        version: '1.0',
        stale_atoms: data.atoms.map((report) => {
          return {
            commit: report.atom.commitHash,
            date: report.atom.date.toISOString(),
            author: report.atom.author,
            [subjectKey]: report.atom.subject,
            protocols: this.serializeProtocols(report.atom, 'all'),
            reasons: report.reasons.map((r) => ({
              signal: r.signal,
              description: r.description,
            })),
          };
        }),
      },
      null,
      2,
    );
  }

  formatTraceResult(data: FormattableTraceResult): string {
    const subjectKey = this.getSubjectKey();

    return JSON.stringify(
      {
        version: '1.0',
        root: {
          commit: data.root.commitHash,
          date: data.root.date.toISOString(),
          author: data.root.author,
          [subjectKey]: data.root.subject,
          protocols: this.serializeProtocols(data.root, 'all'),
        },
        edges: data.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
          relationship: edge.relationship,
          resolved: edge.targetAtom !== null,
          target_atom: edge.targetAtom
            ? {
                commit: edge.targetAtom.commitHash,
                date: edge.targetAtom.date.toISOString(),
                author: edge.targetAtom.author,
                [subjectKey]: edge.targetAtom.subject,
                protocols: this.serializeProtocols(edge.targetAtom, 'all'),
              }
            : null,
        })),
      },
      null,
      2,
    );
  }

  formatDoctorResult(data: FormattableDoctorResult): string {
    return JSON.stringify(
      {
        version: '1.0',
        status: data.status,
        checks: data.checks.map((check) => ({
          name: check.name,
          status: check.status,
          message: check.message,
          details: [...check.details],
        })),
        summary: {
          total_checks: data.summary.total,
          errors: data.summary.errors,
          warnings: data.summary.warnings,
          info: data.summary.info,
        },
      },
      null,
      2,
    );
  }

  formatSuccess(message: string, data?: Record<string, unknown>): string {
    return JSON.stringify(
      {
        version: '1.0',
        success: true,
        message,
        ...(data ?? {}),
      },
      null,
      2,
    );
  }

  formatError(code: number, messages: readonly ErrorMessage[]): string {
    return JSON.stringify(
      {
        version: '1.0',
        error: true,
        code,
        messages: messages.map((msg) => ({
          severity: msg.severity,
          field: msg.field ?? null,
          message: msg.message,
        })),
      },
      null,
      2,
    );
  }

  formatConfig(data: FormattableConfigResult): string {
    const cleanTrailers: Record<string, any> = {};

    for (const [key, def] of Object.entries(data.trailers)) {
      const { ui, ...clean } = def;
      const stripped: any = { ...clean };
      
      if (stripped.directives && stripped.directives.length === 0) delete stripped.directives;
      if (stripped.required === false) delete stripped.required;
      if (stripped.validation === 'none') delete stripped.validation;

      cleanTrailers[key] = stripped;
    }

    return JSON.stringify({
      version: data.version,
      permissive: data.permissive,
      trailers: cleanTrailers
    }, null, 2);
  }

  /**
   * Serialize all protocols for an atom.
   */
  serializeAtoms(atoms: readonly Atom[]): Record<string, any>[] {
      return atoms.map(a => this.serializeProtocols(a, 'all'));
  }

  /**
   * Serialize all protocols for an atom.
   */
  serializeProtocols(
    atom: Atom, 
    visibleTrailers: readonly string[] | 'all' = 'all'
  ): Record<string, any> {
    const protocols: Record<string, any> = {};
    for (const [name, state] of atom.protocols.entries()) {
      protocols[name] = this.serializeProtocolState(
        state, 
        name,
        visibleTrailers
      );
    }
    return protocols;
  }

  /**
   * Transforms a full protocol state into a machine-readable object.
   */
  private serializeProtocolState(
    state: ProtocolState,
    protocolName: string,
    visibleTrailers: readonly string[] | 'all'
  ): Record<string, any> {
    const p = this.protocolRegistry.get(protocolName);
    const id = p ? getProtocolIdentity(state, p) : null;

    return {
      id,
      identity_key: p?.def.identityKey ?? null,
      version: p?.def.version ?? '1.0',
      trailers: this.serializeTrailers(state, protocolName, visibleTrailers),
      unauthorized: { ...state.unauthorized },
    };
  }

  /**
   * Transforms trailers into a flat JSON-friendly record using CANONICAL keys.
   * Standardizes on symmetry: what you get out is what you put back in.
   */
  private serializeTrailers(
    state: ProtocolState,
    protocolName: string,
    visibleTrailers: readonly string[] | 'all'
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const trailers = state.trailers;
    const p = this.protocolRegistry.get(protocolName);
    const identityKey = p?.def.identityKey;

    const shouldShow = (key: string): boolean => {
      if (visibleTrailers === 'all') return true;
      return visibleTrailers.includes(key);
    };

    for (const [key, values] of Object.entries(trailers)) {
      if (identityKey && key === identityKey) continue;
      if (!shouldShow(key)) continue;
      if (!values || values.length === 0) continue;
      
      const tDef = p?.trailers.get(key);
      const isScalar = tDef && !tDef.multivalue;

      result[key] = isScalar ? values[0] : [...values];
    }

    return result;
  }
}
