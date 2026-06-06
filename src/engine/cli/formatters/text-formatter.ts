import chalk, { Chalk, type ChalkInstance } from 'chalk';

import { getAuthorizedKeys } from '../../core/logic/protocols.js';
import type { Atom } from '../../core/types/domain.js';
import type {
  FormattableConfigResult,
  FormattableDoctorResult,
  FormattableQueryResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableValidationResult,
} from '../../core/types/output.js';
import type { ErrorMessage,IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';
import { ROOT_NAMESPACE } from '../../util/constants.js';

/**
 * Strategy implementation for human-readable terminal output.
 * Uses chalk for semantic coloring and box-drawing characters for structure.
 *
 * SOLID: SRP -- only responsible for human-readable text formatting.
 */
export class TextFormatter implements IOutputFormatter {
  protected readonly c: ChalkInstance;

  constructor(
    protected readonly protocolRegistry: ProtocolRegistry,
    options: { color: boolean }
  ) {
    // Force color level 1 if requested, otherwise respect global chalk level or default to 0
    const level = options.color ? (chalk.level > 0 ? chalk.level : 1) : 0;
    this.c = new Chalk({ level });
  }



  formatQueryResult(data: FormattableQueryResult): string {
    const { result, visibleTrailers } = data;
    const lines: string[] = [];

    if (result.atoms.length === 0) {
      lines.push(this.c.dim('No decision atoms found.'));
      return lines.join('\n');
    }

    for (const atom of result.atoms) {
      // Agnostic Anchor: Always use short commit hash
      const displayId = atom.commitHash.slice(0, 7);

      // Determine supersession for the displayId
      // In agnostic mode, we just check if the commit itself is superseded
      let isSuperseded = false;
      for (const state of atom.protocols.values()) {
        if (state.supersession?.superseded) {
          isSuperseded = true;
          break;
        }
      }

      lines.push(this.formatAtomHeader(atom, displayId, isSuperseded));

      // Always show the subject line
      lines.push(`  ${this.c.bold(atom.subject)}`);

      if (atom.body) {
        lines.push(`  ${this.c.dim(atom.body)}`);
      }

      const trailerLines = this.formatTrailers(atom, visibleTrailers);
      for (const tl of trailerLines) {
        lines.push(`  ${tl}`);
      }

      lines.push('');
    }

    if (result.atoms.length > 0) {
        lines.push(this.c.dim(`${result.meta.filteredAtoms} of ${result.meta.totalAtoms} atoms shown`));
    }

    return lines.join('\n').trimEnd();
  }

  formatValidationResult(data: FormattableValidationResult): string {
    const lines: string[] = [];

    for (const commitResult of data.results) {
      const icon = commitResult.valid
        ? this.c.green('\u2713')
        : this.c.red('\u2717');
      const label = commitResult.commit.slice(0, 7);
      lines.push(`${icon} ${label}`);


      for (const issue of commitResult.issues) {
        const severity =
          issue.severity === 'error'
            ? this.c.red('\u2717')
            : this.c.yellow('\u26A0');
        lines.push(`  ${severity} [${issue.rule}] ${issue.message}`);
      }
    }

    lines.push('');
    const summaryParts: string[] = [
      `${data.summary.commitsChecked} commit${data.summary.commitsChecked === 1 ? '' : 's'} checked`,
    ];
    if (data.summary.errors > 0) {
      summaryParts.push(this.c.red(`${data.summary.errors} errors`));
    }
    if (data.summary.warnings > 0) {
      summaryParts.push(this.c.yellow(`${data.summary.warnings} warnings`));
    }

    if (data.summary.errors === 0 && data.summary.warnings === 0) {
      summaryParts.push(this.c.green('all valid'));
    }

    lines.push(this.c.dim(summaryParts.join(', ')));

    return lines.join('\n');
  }

  formatStalenessResult(data: FormattableStalenessResult): string {
    const lines: string[] = [];
    
    if (data.atoms.length === 0) {
        return this.c.green('No stale atoms found.');
    }

    for (const report of data.atoms) {
      const displayId = report.atom.commitHash.slice(0, 7);
      const dateStr = report.atom.date.toISOString().slice(0, 10);
      lines.push(`${this.c.yellow('STALE')}  ${this.c.bold(displayId)} (${dateStr})`);
      lines.push(`  ${report.atom.subject}`);

      for (const reason of report.reasons) {
        lines.push(`  ${this.c.yellow('!')} ${reason.description}`);
      }
      lines.push('');
    }

    return lines.join('\n').trimEnd();
  }

  formatTraceResult(data: FormattableTraceResult): string {
    const lines: string[] = [];
    const rootId = data.root.commitHash.slice(0, 7);

    lines.push(`${this.c.bold('Decision Trace:')} ${rootId}`);
    lines.push(this.c.dim(`${data.root.commitHash} - ${data.root.author}`));
    lines.push('');
    lines.push(`${rootId} ${data.root.subject}`);

    for (let i = 0; i < data.edges.length; i++) {
      const edge = data.edges[i];
      const isLast = i === data.edges.length - 1;
      const connector = isLast ? '└──' : '├──';
      const status = edge.targetAtom ? this.c.green('✓') : this.c.red('?');
      
      lines.push(`${connector} [${edge.relationship}] ${status} ${edge.to}`);
      if (edge.targetAtom) {
          lines.push(`    ${this.c.dim(edge.targetAtom.subject)}`);
      }
    }

    return lines.join('\n');
  }

  formatDoctorResult(data: FormattableDoctorResult): string {
    const lines: string[] = [];
    lines.push(this.c.bold('Decision Engine Health Check'));
    lines.push('');

    for (const check of data.checks) {
      const statusLabel = check.status === 'ok' ? this.c.green('OK') : 
                   check.status === 'warning' ? this.c.yellow('WARNING') : 
                   this.c.red('ERROR');
      
      lines.push(`${statusLabel}  ${this.c.bold(check.name)}: ${check.message}`);
      for (const detail of check.details) {
        lines.push(`  ${this.c.dim(detail)}`);
      }
    }

    lines.push('');
    const summary = `${data.summary.errors} errors, ${data.summary.warnings} warnings, ${data.summary.info} checks passed.`;
    lines.push(`${this.c.bold('Summary:')} ${summary}`);

    return lines.join('\n');
  }

  formatSuccess(message: string): string {
    return this.c.green(`✓ ${message}`);
  }

  formatError(code: number, messages: readonly ErrorMessage[]): string {
    const lines: string[] = [this.c.red(`✗ Error (Exit Code: ${code})`)];
    for (const msg of messages) {
      const field = msg.field ? ` [${msg.field}]` : '';
      lines.push(`${this.c.red('!')}${field} ${msg.message}`);
    }
    return lines.join('\n');
  }

  formatConfig(data: FormattableConfigResult): string {
      const lines: string[] = [];
      lines.push(this.c.bold(`Active Protocol Configurations (Engine v${data.engineVersion})`));
      lines.push('');

      for (const p of data.protocols) {
          const nsDisplay = p.namespace === ROOT_NAMESPACE ? '(none)' : `"${p.namespace}"`;
          lines.push(this.c.bold(`\u2500\u2500 Protocol: ${p.name} (v${p.version}) `));
          lines.push(this.c.dim(`   Namespace: ${nsDisplay}, Permissive: ${p.permissive}`));
          lines.push('');

          const trailerEntries = Object.entries(p.trailers);
          if (trailerEntries.length === 0) {
              lines.push(this.c.dim('   (No matching trailers defined)'));
          } else {
              for (const [key, def] of trailerEntries) {
                  const colorName = def.ui?.color || 'dim';
                  const color = this.getTrailerColor(colorName);
                  lines.push(`   ${color(key + ':')} ${def.description}`);
                  if (def.validation === 'values' && def.values) {
                      lines.push(this.c.dim(`     Allowed values: ${Object.keys(def.values).join(', ')}`));
                  }
              }
          }
          lines.push('');
      }

      return lines.join('\n').trimEnd();
  }

  private formatAtomHeader(atom: Atom, displayId: string, superseded: boolean): string {
    const dateStr = atom.date.toISOString().slice(0, 10);
    const header = `\u2500\u2500 ${displayId} (${dateStr}, ${atom.author}) `;
    const rule = '\u2500'.repeat(Math.max(0, 60 - header.length));
    const fullHeader = header + rule;

    if (superseded) {
      return this.c.dim.strikethrough(fullHeader);
    }
    return this.c.bold(fullHeader);
  }

  private formatTrailers(atom: Atom, visibleTrailers: readonly string[] | 'all'): string[] {
    const lines: string[] = [];
    const shouldShow = (key: string): boolean => {
      if (visibleTrailers === 'all') return true;
      return visibleTrailers.includes(key);
    };

    for (const [pName, state] of atom.protocols) {
      const p = this.protocolRegistry.get(pName);
      if (!p) continue;

      const authorizedKeys = getAuthorizedKeys(p);
      const allStateKeys = Object.keys(state.trailers);
      const renderedKeys = new Set<string>();

      for (const key of authorizedKeys) {
        
        if (!shouldShow(key)) continue;

        const values = state.trailers[key];
        if (!values || values.length === 0) continue;

        const def = p.trailers.get(key);
        const colorName = def?.ui?.color || 'dim';
        const color = this.getTrailerColor(colorName);
        
        // Engine Baseline: ALWAYS prefix trailers with the protocol name in text format.
        const label = `[${pName}] ${key}`;

        for (const val of values) {
          lines.push(`${color(label + ':')} ${val}`);
        }
        renderedKeys.add(key);
      }

      // Format remaining trailers (permissive/adhoc)
      for (const key of allStateKeys) {
          if (renderedKeys.has(key)) continue;
          
          
          if (!shouldShow(key)) continue;

          const values = state.trailers[key];
          if (!values || values.length === 0) continue;

          const label = `[${pName}] ${key}`;
          const color = this.getTrailerColor('dim');
          for (const val of values) {
              lines.push(`${color(label + ':')} ${val}`);
          }
      }

      // Format Unauthorized
      if (state.unauthorized) {
          for (const [key, values] of Object.entries(state.unauthorized)) {
              const label = `[${pName}] ${key}`;
              for (const val of values) {
                  lines.push(this.c.red(`${label}: ${val} (UNAUTHORIZED)`));
              }
          }
      }

      // Format Supersession (Protocol-Specific)
      if (state.supersession?.superseded && state.supersession.supersededBy?.length) {
          const successors = state.supersession.supersededBy.join(', ');
          lines.push(this.c.dim(`   [${pName}] (superseded by ${successors})`));
      }
    }

    return lines;
  }

  private getTrailerColor(name: string): ChalkInstance {
    const colors: Record<string, keyof ChalkInstance> = {
      dim: 'dim',
      red: 'red',
      green: 'green',
      yellow: 'yellow',
      cyan: 'cyan',
      blue: 'blue',
      magenta: 'magenta',
      white: 'white',
    };
    const key = colors[name] || 'dim';
    return this.c[key] as ChalkInstance;
  }

}
