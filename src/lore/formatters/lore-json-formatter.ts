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
import { snakeCase } from '../../util/string.js';
import type { ProtocolRegistry } from '../../engine/services/protocol-registry.js';

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
      this.inner = new JsonFormatter(protocolRegistry, 'Intent');
  }

  formatQueryResult(data: FormattableQueryResult): string {
    const loreProtocol = this.protocolRegistry.get('lore');
    const version = loreProtocol?.version ?? '1.0';

    const results = data.result.atoms.map((atom) => {
      const loreState = atom.protocols.get('lore');
      const loreId = loreState ? loreProtocol?.getIdentity(loreState.trailers) : null;
      const supersession = loreId ? data.supersessionMap.get(loreId) : undefined;

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
        superseded: supersession?.superseded ?? false,
        superseded_by: supersession?.supersededBy ?? null,
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
        const loreId = loreState ? loreProtocol?.getIdentity(loreState.trailers) : null;

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
    return this.inner.formatDoctorResult(data);
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
