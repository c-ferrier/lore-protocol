import { getProtocolIdentity } from '../../engine/core/logic/identity.js';
import {  
    type Atom,
    type ErrorMessage,
    type FormattableConfigResult,
    type FormattableDoctorResult, 
    type FormattableQueryResult, 
    type FormattableStalenessResult, 
    type FormattableTraceResult, 
    type FormattableValidationResult, 
    type IOutputFormatter,
    type ProtocolContext,
    ProtocolMap,
    snakeCase,
    SYSTEM_PROTOCOL } from '../../engine/index.js';

/**
 * Lore CLI 0.5.0 Legacy JSON Formatter.
 * 
 * Provides 100% backward compatibility with the Lore 0.5.0 monolithic JSON schema.
 * 
 * NOTE: This formatter is stateful. It buffers atoms from the streaming hooks 
 * and flushes a single, valid JSON document in the footer. 
 * This sacrifices zero-latency printing for absolute legacy parity.
 */
export class LoreJsonFormatter implements IOutputFormatter {
  private bufferedAtoms: Atom[] = [];
  private currentHeader: { target: string; type: string; visibleTrailers: readonly string[] | 'all' } | null = null;

  constructor(private readonly protocols: ProtocolMap<ProtocolContext>) {}

  /**
   * Monolithic entry point (Legacy/Direct calls)
   */
  formatQueryResult(data: FormattableQueryResult): string {
      const { result, visibleTrailers } = data;
      return this.reconstructMonolithic(
          result.atoms,
          result.command,
          result.target,
          result.targetType,
          {
              total: result.meta.totalAtoms,
              filtered: result.meta.filteredAtoms,
              oldest: result.meta.oldest,
              newest: result.meta.newest
          },
          visibleTrailers
      );
  }

  /**
   * Streaming Hook: Header
   * Buffers metadata, returns nothing.
   */
  formatHeader(target: string, type: string, visibleTrailers?: readonly string[] | 'all'): string {
      this.bufferedAtoms = [];
      this.currentHeader = { target, type, visibleTrailers: visibleTrailers || 'all' };
      return '';
  }

  /**
   * Streaming Hook: Atom
   * Buffers the atom, returns nothing.
   */
  formatAtom(atom: Atom): string {
      this.bufferedAtoms.push(atom);
      return '';
  }

  /**
   * Streaming Hook: Footer
   * Performs the final reconstruction and flushes the monolithic JSON.
   */
  formatFooter(meta: { total: number; filtered: number; oldest: Date | null; newest: Date | null }): string {
      const output = this.reconstructMonolithic(
          this.bufferedAtoms,
          'log', // Defaults to log for streaming commands
          this.currentHeader?.target || 'all',
          this.currentHeader?.type || 'global',
          meta,
          this.currentHeader?.visibleTrailers || 'all'
      );
      
      // Reset state for next potential run in same process
      this.bufferedAtoms = [];
      this.currentHeader = null;
      
      return output;
  }

  /**
   * Internal logic to build the exact 0.5.0 Lore JSON structure.
   */
  private reconstructMonolithic(
      atoms: readonly Atom[],
      command: string,
      target: string,
      targetType: string,
      meta: { total: number; filtered: number; oldest: Date | null; newest: Date | null },
      visibleTrailers: readonly string[] | 'all' = 'all'
  ): string {
    const loreProtocol = this.protocols.get('lore');
    const version = loreProtocol?.def.version ?? '1.0';

    const results = atoms.map((atom) => {
      const loreState = atom.protocols.get('lore');
      const loreId = (loreState && loreProtocol) ? getProtocolIdentity(loreState, loreProtocol) : null;
      const status = (loreState && loreState.supersession) ? loreState.supersession : { superseded: false, supersededBy: [] };

      const trailers: Record<string, string | string[] | null> = {};
      
      // 1. Lore Trailers
      if (loreState && loreProtocol) {
          for (const [key, values] of Object.entries(loreState.trailers)) {
              // Apply visibility filter
              if (visibleTrailers !== 'all' && !visibleTrailers.includes(key)) continue;

              const def = loreProtocol.def.trailers[key];
              const isScalar = def && !def.multivalue;
              trailers[snakeCase(key)] = isScalar ? values[0] : [...values];
          }
      }

      // 2. System Trailers (Ad-hoc and Git-native)
      const systemState = atom.protocols.get(SYSTEM_PROTOCOL);
      const systemProtocol = this.protocols.get(SYSTEM_PROTOCOL);
      if (systemState && systemProtocol) {
          for (const [key, values] of Object.entries(systemState.trailers)) {
              // Apply visibility filter
              if (visibleTrailers !== 'all' && !visibleTrailers.includes(key)) continue;

              // If it's already in trailers (collided with lore), skip it
              const sKey = snakeCase(key);
              if (trailers[sKey] !== undefined) continue;

              const def = systemProtocol.def.trailers[key];
              const isScalar = !def || !def.multivalue; // Standard git trailers are scalar
              trailers[sKey] = isScalar ? values[0] : [...values];
          }
      }

      // 0.5.0 included lore_id inside trailers too
      if (loreId) trailers.lore_id = loreId;

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
      command,
      target: target === 'all' || targetType === 'global' ? 'all' : target,
      target_type: targetType,
      meta: {
        total_atoms: meta.total,
        filtered_atoms: meta.filtered,
        oldest: meta.oldest?.toISOString() ?? null,
        newest: meta.newest?.toISOString() ?? null,
      },
      results
    }, null, 2);
  }

  formatValidationResult(data: FormattableValidationResult): string {
    const loreProtocol = this.protocols.get('lore');
    
    return JSON.stringify({
        lore_version: loreProtocol?.def.version ?? '1.0',
        summary: {
            commits_checked: data.summary.commitsChecked,
            errors: data.summary.errors,
            warnings: data.summary.warnings
        },
        results: data.results.map(r => ({
            commit: r.commit,
            valid: r.valid,
            identity: r.identities['lore'] || null,
            issues: r.issues.map(i => ({
                severity: i.severity,
                rule: i.rule,
                message: i.message
            }))
        }))
    }, null, 2);
  }

  formatStalenessResult(data: FormattableStalenessResult): string {
    const loreProtocol = this.protocols.get('lore');
    
    return JSON.stringify({
      lore_version: loreProtocol?.def.version ?? '1.0',
      stale_atoms: data.atoms.map((report) => {
        const loreState = report.atom.protocols.get('lore');
        const loreId = (loreState && loreProtocol) ? getProtocolIdentity(loreState, loreProtocol) : null;

        const trailers: Record<string, string | string[] | null> = {};
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
    const loreProtocol = this.protocols.get('lore');
    const version = loreProtocol?.def.version ?? '1.0';

    const renderNode = (node: Atom) => {
        const loreState = node.protocols.get('lore');
        const loreId = (loreState && loreProtocol) ? getProtocolIdentity(loreState, loreProtocol) : null;
        return {
            lore_id: loreId,
            commit: node.commitHash,
            intent: node.subject
        };
    };

    return JSON.stringify({
        lore_version: version,
        root: renderNode(data.root),
        edges: data.edges.map(e => ({
            from: e.from,
            to: e.to,
            relationship: e.relationship,
            target: e.targetAtom ? renderNode(e.targetAtom) : null
        }))
    }, null, 2);
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
        lore_version: this.protocols.get('lore')?.def.version ?? '1.0',
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
      lore_version: this.protocols.get('lore')?.def.version ?? '1.0',
      success: true,
      message: `Commit created: ${hash}`,
      hash: hash
    }, null, 2);
  }

  formatError(code: number, messages: readonly ErrorMessage[]): string {
    return JSON.stringify({
      lore_version: this.protocols.get('lore')?.def.version ?? '1.0',
      error: true,
      code,
      messages: messages.map(m => ({
          severity: m.severity,
          field: m.field ?? null,
          message: m.message
      }))
    }, null, 2);
  }

  formatConfigResult(data: FormattableConfigResult): string {
    const loreProtocol = this.protocols.get('lore');
    return JSON.stringify({
        lore_version: loreProtocol?.def.version ?? '1.0',
        protocols: data.protocols.map(p => ({
            name: p.name,
            version: p.version,
            namespace: p.namespace,
            trailers: p.trailers
        }))
    }, null, 2);
  }
}
