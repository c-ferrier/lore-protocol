import chalk, { type ChalkInstance } from 'chalk';

import { type Atom, ProtocolMap } from '../../core/types/domain.js';
import type {
  FormattableConfigResult,
  FormattableDoctorResult,
  FormattableQueryResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableValidationResult,
} from '../../core/types/output.js';
import type { ProtocolContext } from '../../core/types/protocol-definition.js';
import type { ErrorMessage, IOutputFormatter } from '../../interfaces/output-formatter.js';

/**
 * Base Text Formatter for the Engine CLI.
 * Provides mandatory protocol prefixes for multi-protocol clarity.
 */
export class TextFormatter implements IOutputFormatter {
  protected readonly c: ChalkInstance;

  constructor(
    protected readonly protocols: ProtocolMap<ProtocolContext>,
    options: { color: boolean }
  ) {
    this.c = options.color 
      ? new (chalk.constructor as new (opts: { level: number }) => ChalkInstance)({ level: 1 }) 
      : chalk;
  }





  formatQueryResult(data: FormattableQueryResult): string {
    const { result } = data;
    const lines: string[] = [];

    if (result.atoms.length === 0) {
        return this.c.dim('No decision atoms found.');
    }

    for (const atom of result.atoms) {
      lines.push(this.formatAtom(atom, data.visibleTrailers));
      lines.push('');
    }

    lines.push(this.formatFooter({
        total: result.meta.totalAtoms,
        filtered: result.meta.filteredAtoms,
        oldest: result.meta.oldest,
        newest: result.meta.newest
    }));
    return lines.join('\n').trimEnd();
  }

  formatConfig(data: FormattableConfigResult): string {
    const lines: string[] = [`Active Protocol Configurations (Engine v${data.engineVersion})`, ''];

    for (const p of data.protocols) {
      lines.push(this.c.bold(`── Protocol: ${p.name} (v${p.version}) `));
      lines.push(`   Namespace: ${p.namespace ? `"${p.namespace}"` : '(none)'}, Permissive: ${p.permissive}`);
      lines.push('');

      const trailerEntries = Object.entries(p.trailers);
      if (trailerEntries.length === 0) {
          lines.push('   (No matching trailers defined)');
      } else {
          for (const [key, t] of trailerEntries) {
            lines.push(`   ${this.c.bold(`${key}:`)} ${t.description}`);
            if (t.values) {
                lines.push(`     Allowed values: ${Object.keys(t.values).join(', ')}`);
            }
          }
      }
      lines.push('');
    }

    return lines.join('\n').trimEnd();
  }

  formatValidationResult(data: FormattableValidationResult): string {
      const lines: string[] = [];
      for (const r of data.results) {
          const icon = r.valid ? this.c.green('\u2713') : this.c.red('✗');
          lines.push(`${icon} ${r.commit.slice(0, 8)}`);
          for (const i of r.issues) {
              const s = i.severity === 'error' ? this.c.red('✗') : this.c.yellow('\u26A0');
              lines.push(`  ${s} [${i.rule}] ${i.message}`);
          }
      }
      if (data.results.length > 0) {
          const errors = data.summary.errors;
          const warnings = data.summary.warnings;
          if (errors === 0 && warnings === 0) {
              lines.push('\nall valid');
          } else {
              lines.push(`\n${errors} errors, ${warnings} warnings`);
          }
      }
      return lines.join('\n').trimEnd();
  }

  formatStalenessResult(data: FormattableStalenessResult): string {
      if (data.atoms.length === 0) return this.c.green('No stale atoms found');
      
      const lines: string[] = [];
      for (const r of data.atoms) {
          const dateStr = r.atom.date.toISOString().slice(0, 10);
          lines.push(`${this.c.yellow('STALE')} ${r.atom.commitHash.slice(0, 8)} (${dateStr})`);
          for (const reason of r.reasons) {
              lines.push(`  ${this.c.yellow('⚠')} ${reason.description}`);
          }
      }
      return lines.join('\n').trimEnd();
  }

  formatTraceResult(data: FormattableTraceResult): string {
      const lines: string[] = [`${data.root.commitHash.slice(0, 8)} ${data.root.subject}`];
      const BORDER = '\u2514\u2500\u2500';

      for (const e of data.edges) {
          const target = e.targetAtom;
          // Promoting ID for trace edges
          const targetId = target?.protocols.get('lore')?.trailers['Lore-id']?.[0] || target?.protocols.get('mock')?.trailers['Mock-id']?.[0] || target?.commitHash.slice(0, 8);
          lines.push(`${BORDER} [${e.relationship}] ${targetId} ${target?.subject}`);
      }
      return lines.join('\n');
  }

  formatDoctorResult(data: FormattableDoctorResult): string {
      const lines: string[] = ['Decision Engine Health Check', ''];
      for (const c of data.checks) {
          const s = c.status === 'ok' ? this.c.green('OK') : c.status === 'warning' ? this.c.yellow('WARNING') : this.c.red('ERROR');
          lines.push(`${s}  ${c.name}: ${c.message}`);
          for (const d of c.details) lines.push(`  ${this.c.dim(d)}`);
      }
      const okCount = data.checks.filter((check: { status: string }) => check.status === 'ok').length;
      lines.push(`\nSummary: ${data.summary.errors} errors, ${data.summary.warnings} warnings, ${okCount} checks passed.`);
      return lines.join('\n');
  }

  formatSuccess(message: string): string {
    return this.c.green(message);
  }

  formatError(code: number, messages: readonly ErrorMessage[]): string {
    const lines: string[] = [this.c.red(`Error ${code}:`)];
    for (const m of messages) {
      lines.push(`  ${this.c.red('✗')} [${m.rule || 'unknown'}] ${m.message}`);
    }
    return lines.join('\n');
  }

  formatHeader(target: string, type: string, _visibleTrailers?: readonly string[] | 'all'): string {
    return `Query: ${this.c.bold(target)} (${type})\n`;
  }

  formatAtom(atom: Atom, visibleTrailers: readonly string[] | 'all' = 'all'): string {
    const lines: string[] = [];
    const dateStr = atom.date.toISOString().slice(0, 10);
    const header = `── ${atom.commitHash.slice(0, 7)} (${dateStr}, ${atom.author}) `;
    const rule = '─'.repeat(Math.max(0, 60 - header.length));
    lines.push(this.c.bold(header + rule));
    lines.push(`  ${atom.subject}`);

    if (atom.body) {
        lines.push(`  ${atom.body}`);
    }

    const trailerLines: string[] = [];
    const renderedKeys = new Set<string>();

    // 1. Render Structured Trailers (Highest Priority)
    for (const [pName, state] of atom.protocols) {
        const prefix = `[${pName}] `;
        
        // Authorized
        for (const [key, values] of Object.entries(state.trailers)) {
            if (visibleTrailers !== 'all' && !visibleTrailers.includes(key)) continue;
            for (const v of values) {
                trailerLines.push(`  ${prefix}${this.c.bold(`${key}:`)} ${v}`);
                renderedKeys.add(key.toLowerCase());
            }
        }
        
        // Unauthorized/Rejected
        for (const [key, values] of Object.entries(state.unauthorized)) {
            if (visibleTrailers !== 'all' && !visibleTrailers.includes(key)) continue;
            for (const v of values) {
                trailerLines.push(`  ${prefix}${this.c.yellow('⚠')} ${this.c.bold(`${key}:`)} ${v}`);
                renderedKeys.add(key.toLowerCase());
            }
        }
    }

    // 2. Render Ad-hoc Fallback (Dim color)
    const rawLines = atom.rawTrailers.split('\n');
    for (const line of rawLines) {
        const match = line.match(/^([A-Za-z0-9][A-Za-z0-9-]*):\s*(.*)$/);
        if (match) {
            const key = match[1];
            const val = match[2];
            const lowerKey = key.toLowerCase();

            if (!renderedKeys.has(lowerKey)) {
                if (visibleTrailers === 'all' || visibleTrailers.includes(key)) {
                    trailerLines.push(this.c.dim(`  ${key}: ${val}`));
                    renderedKeys.add(lowerKey);
                }
            }
        }
    }

    // 3. Supersession
    for (const [pName, state] of atom.protocols) {
        if (state.supersession?.superseded) {
            const killers = state.supersession.supersededBy.map(h => h.slice(0, 8)).join(', ');
            trailerLines.push(`  [${pName}] ${this.c.dim(`(superseded by ${killers})`)}`);
        }
    }

    lines.push(...trailerLines);
    return lines.join('\n');
  }

  formatFooter(meta: { total: number; filtered: number; oldest: Date | null; newest: Date | null }): string {
    return `${meta.filtered} of ${meta.total} atoms shown`;
  }
}
