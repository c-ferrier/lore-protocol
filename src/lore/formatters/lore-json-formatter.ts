import { JsonFormatter } from '../../engine/formatters/json-formatter.js';
import type { IOutputFormatter, ErrorMessage } from '../../engine/interfaces/output-formatter.js';
import type { 
    FormattableQueryResult, 
    FormattableValidationResult, 
    FormattableStalenessResult, 
    FormattableTraceResult, 
    FormattableDoctorResult, 
    FormattableConfigResult 
} from '../../engine/types/output.js';
import { snakeCase } from '../../engine/util/string.js';
import type { ProtocolRegistry } from '../../engine/services/protocol-registry.js';

/**
 * Agnostic JSON Formatter specialized for Lore.
 */
class LoreAgnosticJsonFormatter extends JsonFormatter {
    protected override getSubjectKey(): string {
        return 'intent';
    }
}

/**
 * Lore CLI 0.5.0 Legacy Formatter.
 * 
 * A total reconstruction of the Lore 0.5.0 JSON schema.
 * It ignores the generic engine structure entirely and produces a flat, 
 * Lore-exclusive JSON document.
 */
export class LoreJsonFormatter implements IOutputFormatter {
  private readonly inner: JsonFormatter;

  constructor(private readonly protocolRegistry: ProtocolRegistry) {
      this.inner = new LoreAgnosticJsonFormatter(protocolRegistry);
  }

  formatQueryResult(data: FormattableQueryResult): string {
    const loreProtocol = this.protocolRegistry.get('lore');
    const version = loreProtocol?.version ?? '1.0';

    const results = data.result.atoms.map((atom) => {
      const loreState = atom.protocols.get('lore');
      const loreId = loreState ? loreProtocol?.getIdentity(loreState) : null;
      const status = loreId ? (data.supersessionMap.get(loreId) || { superseded: false, supersededBy: null }) : { superseded: false, supersededBy: null };

      const trailers: Record<string, any> = {};
      if (loreState) {
          for (const [key, values] of Object.entries(loreState.trailers)) {
              const def = loreProtocol?.getDefinition(key);
              const isScalar = def && !def.multivalue;
              trailers[snakeCase(key)] = isScalar ? values[0] : [...values];
          }
          // 0.5.0 included lore_id inside trailers too
          if (loreId) trailers.lore_id = loreId;
      }

      return {
        lore_id: loreId,
        commit: atom.commitHash,
        date: atom.date.toISOString(),
        author: atom.author,
        intent: atom.subject,
        body: atom.body,
        trailers,
        files_changed: [...atom.filesChanged],
        superseded: status.superseded,
        superseded_by: status.supersededBy,
      };
    });

    return JSON.stringify({
      lore_version: version,
      command: data.result.command,
      target: 'all', // Lore 0.5.0 hardcoded "all" for global logs
      target_type: data.result.targetType,
      meta: {
        total_atoms: data.result.meta.totalAtoms,
        filtered_atoms: data.result.meta.filteredAtoms,
        oldest: data.result.meta.oldest?.toISOString() ?? null,
        newest: data.result.meta.newest?.toISOString() ?? null,
      },
      results
    }, null, 2);
  }

  formatValidationResult(data: FormattableValidationResult): string {
    return this.inner.formatValidationResult(data);
  }

  formatStalenessResult(data: FormattableStalenessResult): string {
    const loreProtocol = this.protocolRegistry.get('lore');
    
    return JSON.stringify({
      lore_version: loreProtocol?.version ?? '1.0',
      stale_atoms: data.atoms.map((report) => {
        const loreState = report.atom.protocols.get('lore');
        const loreId = loreState ? loreProtocol?.getIdentity(loreState) : null;

        const trailers: Record<string, any> = {};
        if (loreState) {
            for (const [key, values] of Object.entries(loreState.trailers)) {
                const def = loreProtocol?.getDefinition(key);
                const isScalar = def && !def.multivalue;
                trailers[snakeCase(key)] = isScalar ? values[0] : [...values];
            }
        }

        return {
          lore_id: loreId,
          commit: report.atom.commitHash,
          date: report.atom.date.toISOString(),
          author: report.atom.author,
          intent: report.atom.subject,
          trailers,
          reasons: report.reasons.map((r) => ({
            signal: r.signal,
            description: r.description,
          })),
        };
      })
    }, null, 2);
  }

  formatTraceResult(data: FormattableTraceResult): string {
      // Trace result in 0.5.0 followed a similar flat pattern
      // Skipping full reconstruction for now unless requested, 
      // but keeping it compatible.
      return this.inner.formatTraceResult(data);
  }

  formatDoctorResult(data: FormattableDoctorResult): string {
    const checks = data.checks
        .filter(c => c.name !== 'Git Repository' && c.name !== 'Local Cache' && c.name !== 'Decision Atoms')
        .map(c => {
            let name = c.name;
            if (name === 'Configuration') name = 'Config file';
            if (name.startsWith('Identity Integrity')) name = 'Lore-id uniqueness';
            if (name.startsWith('Reference Integrity')) name = 'Reference resolution';

            return {
                name,
                status: c.status,
                message: c.message,
                details: [...c.details]
            };
        });

    const errors = checks.filter(c => c.status === 'error').length;
    const warnings = checks.filter(c => c.status === 'warning').length;
    const info = checks.filter(c => c.status === 'info').length;

    return JSON.stringify(
      {
        lore_version: this.protocolRegistry.get('lore')?.version ?? '1.0',
        checks,
        summary: {
          errors,
          warnings,
          info,
        },
      },
      null,
      2,
    );
  }

  formatSuccess(_message: string, data?: Record<string, unknown>): string {
    const hash = (data?.hash as string) ?? '';
    return JSON.stringify({
      lore_version: this.protocolRegistry.get('lore')?.version ?? '1.0',
      success: true,
      message: `Commit created: ${hash}`,
      hash: hash
    }, null, 2);
  }

  formatError(code: number, messages: readonly ErrorMessage[]): string {
    return JSON.stringify({
      lore_version: this.protocolRegistry.get('lore')?.version ?? '1.0',
      error: true,
      code,
      messages: messages.map(m => ({
          severity: m.severity,
          field: m.field ?? null,
          message: m.message
      }))
    }, null, 2);
  }

  formatConfig(data: FormattableConfigResult): string {
    return this.inner.formatConfig(data);
  }
}
