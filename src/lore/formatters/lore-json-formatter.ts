import { createBaseFormatter } from '../../engine/cli/formatters/index.js';
import { getProtocolIdentity } from '../../engine/core/logic/identity.js';
import {  
    type ErrorMessage,
    type FormattableConfigResult,
    type FormattableDoctorResult, 
    type FormattableQueryResult, 
    type FormattableStalenessResult, 
    type FormattableTraceResult, 
    type FormattableValidationResult, 
    type IOutputFormatter,
    type ProtocolRegistry,
    snakeCase
 } from '../../engine/index.js';

/**
 * Lore CLI 0.5.0 Legacy JSON Formatter.
 * 
 * Uses Composition over Inheritance: wraps the base engine formatter 
 * and provides a total reconstruction of the Lore 0.5.0 JSON schema.
 * 
 * It ignores the generic engine structure entirely and produces a flat, 
 * Lore-exclusive JSON document for backward compatibility.
 */
export class LoreJsonFormatter implements IOutputFormatter {
  private readonly inner: IOutputFormatter;

  constructor(private readonly protocolRegistry: ProtocolRegistry) {
      this.inner = createBaseFormatter('json', protocolRegistry);
  }

  formatQueryResult(data: FormattableQueryResult): string {
    const loreProtocol = this.protocolRegistry.get('lore');
    const version = loreProtocol?.def.version ?? '1.0';

    const results = data.result.atoms.map((atom) => {
      const loreState = atom.protocols.get('lore');
      const loreId = (loreState && loreProtocol) ? getProtocolIdentity(loreState, loreProtocol) : null;
      const status = (loreState && loreState.supersession) ? loreState.supersession : { superseded: false, supersededBy: [] };

      const trailers: Record<string, any> = {};
      if (loreState && loreProtocol) {
          for (const [key, values] of Object.entries(loreState.trailers)) {
              const def = loreProtocol.def.trailers[key];
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
        author: atom.author.includes('<') 
            ? atom.author.match(/<([^>]+)>/)?.[1] || atom.author 
            : atom.author,
        intent: atom.subject,
        body: atom.body,
        trailers,
        files_changed: [...atom.filesChanged],
        superseded: status.superseded,
        superseded_by: status.supersededBy?.[0] ?? null,
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
      lore_version: loreProtocol?.def.version ?? '1.0',
      stale_atoms: data.atoms.map((report) => {
        const loreState = report.atom.protocols.get('lore');
        const loreId = (loreState && loreProtocol) ? getProtocolIdentity(loreState, loreProtocol) : null;

        const trailers: Record<string, any> = {};
        if (loreState && loreProtocol) {
            for (const [key, values] of Object.entries(loreState.trailers)) {
                const def = loreProtocol.def.trailers[key];
                const isScalar = def && !def.multivalue;
                trailers[snakeCase(key)] = isScalar ? values[0] : [...values];
            }
        }

        return {
          lore_id: loreId,
          commit: report.atom.commitHash,
          date: report.atom.date.toISOString(),
          author: report.atom.author.includes('<') 
              ? report.atom.author.match(/<([^>]+)>/)?.[1] || report.atom.author 
              : report.atom.author,
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
        lore_version: this.protocolRegistry.get('lore')?.def.version ?? '1.0',
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
      lore_version: this.protocolRegistry.get('lore')?.def.version ?? '1.0',
      success: true,
      message: `Commit created: ${hash}`,
      hash: hash
    }, null, 2);
  }

  formatError(code: number, messages: readonly ErrorMessage[]): string {
    return JSON.stringify({
      lore_version: this.protocolRegistry.get('lore')?.def.version ?? '1.0',
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
