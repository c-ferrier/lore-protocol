import { getProtocolIdentity } from '../../engine/core/logic/identity.js';
import {  
    type Atom,
    type ErrorMessage,
    type FormattableConfigResult,
    type FormattableDoctorResult, 
    type FormattableQueryAtom,
    type FormattableQueryFooter,
    type FormattableQueryHeader,
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
  private isFirstAtom = true;
  private currentHeader: { target: string; type: string; visibleTrailers: readonly string[] | 'all' } | null = null;

  constructor(private readonly protocols: ProtocolMap<ProtocolContext>) {}

  /**
   * Streaming Hook: Header
   * Emits the opening of the JSON document.
   */
  formatQueryHeader(data: FormattableQueryHeader): string {
      this.isFirstAtom = true;
      this.currentHeader = data;
      
      const loreProtocol = this.protocols.get('lore');
      const version = loreProtocol?.def.version ?? '1.0';

      const header = {
          lore_version: version,
          command: 'log', // Match 0.5.0 default
          target: data.target === 'all' || data.type === 'global' ? 'all' : data.target,
          target_type: data.type,
      };

      // Open the object and the results array
      // We must strip the closing brace of the stringified header to append "results"
      const headerStr = JSON.stringify(header, null, 2);
      return headerStr.substring(0, headerStr.length - 2) + ',\n  "results": [';
  }

  /**
   * Streaming Hook: Atom
   * Emits a single atom object, handling comma separation.
   */
  formatQueryAtom(data: FormattableQueryAtom): string {
      const result = this.formatSingleAtomObject(data.atom, data.visibleTrailers);
      const comma = this.isFirstAtom ? '' : ',';
      this.isFirstAtom = false;

      // Indent the individual atom JSON to match 0.5.0 nested structure
      const atomStr = JSON.stringify(result, null, 2)
          .split('\n')
          .map(line => '    ' + line)
          .join('\n');

      return `${comma}\n${atomStr}`;
  }

  /**
   * Streaming Hook: Footer
   * Closes the results array and appends the meta object.
   */
  formatQueryFooter(data: FormattableQueryFooter): string {
      const metaObj = {
          total_atoms: data.total,
          filtered_atoms: data.filtered,
          oldest: data.oldest?.toISOString() ?? null,
          newest: data.newest?.toISOString() ?? null
      };

      const output = `\n  ],\n  "meta": ${JSON.stringify(metaObj, null, 2).split('\n').map((l, i) => i === 0 ? l : '  ' + l).join('\n')}\n}`;
      
      // Reset state
      this.currentHeader = null;
      this.isFirstAtom = true;
      
      return output;
  }

  /**
   * Internal logic to transform a single Atom into the 0.5.0 Result Object.
   */
  private formatSingleAtomObject(atom: Atom, visibleTrailers: readonly string[] | 'all'): Record<string, unknown> {
    const loreProtocol = this.protocols.get('lore');
    const loreState = atom.protocols.get('lore');
    const loreId = (loreState && loreProtocol) ? getProtocolIdentity(loreState, loreProtocol) : null;
    const status = (loreState && loreState.supersession) ? loreState.supersession : { superseded: false, supersededBy: [] };

    const trailers: Record<string, string | string[] | null> = {};
    
    // 1. Lore Trailers
    if (loreState && loreProtocol) {
        for (const [key, values] of Object.entries(loreState.trailers)) {
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
            if (visibleTrailers !== 'all' && !visibleTrailers.includes(key)) continue;

            const sKey = snakeCase(key);
            if (trailers[sKey] !== undefined) continue;

            const def = systemProtocol.def.trailers[key];
            const isScalar = !def || !def.multivalue;
            trailers[sKey] = isScalar ? values[0] : [...values];
        }
    }

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
