import chalk, { Chalk, type ChalkInstance } from 'chalk';

import type { IOutputFormatter, ErrorMessage } from '../interfaces/output-formatter.js';
import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
  FormattableConfigResult,
} from '../core/types/output.js';
import type { Atom } from '../core/types/domain.js';
import type { ProtocolRegistry } from '../services/protocol-registry.js';
import { getProtocolIdentity } from '../core/logic/identity.js';

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
    this.c = new Chalk({ level: options.color ? (chalk.level || 1) : 0 });
  }

  formatQueryResult(data: FormattableQueryResult): string {
    const { result, visibleTrailers } = data;
    const lines: string[] = [];

    if (result.atoms.length === 0) {
      lines.push(this.c.dim('No decision atoms found.'));
      return lines.join('\n');
    }

    for (const atom of result.atoms) {
      // Find a representative ID for the header (root preferred)
      const rootProtocol = this.protocolRegistry.getRoot();
      const primaryState = rootProtocol ? atom.protocols.get(rootProtocol.name.toLowerCase()) || atom.protocols.get(rootProtocol.name) : null;
      
      let id = rootProtocol ? getProtocolIdentity(primaryState, rootProtocol) : undefined;
      if (!id) {
          // Try to find ANY protocol identity
          for (const [name, state] of atom.protocols) {
              const p = this.protocolRegistry.get(name);
              id = p ? getProtocolIdentity(state, p) : undefined;
              if (id) break;
          }
      }

      // Final fallback to shortened commit hash
      const displayId = id || atom.commitHash.slice(0, 8);

      // Determine supersession for the displayId
      const isSuperseded = primaryState?.supersession?.superseded ?? false;

      const header = this.formatAtomHeader(atom, displayId, isSuperseded);
      lines.push(header);

      if (isSuperseded && primaryState?.supersession?.supersededBy?.length) {
        const successors = primaryState.supersession.supersededBy.join(', ');
        lines.push(this.c.dim(`  (superseded by ${successors})`));
      }

      // Always show the subject line
      lines.push(`  ${this.c.bold(atom.subject)}`);

      if (atom.body) {
        lines.push(`  ${this.c.dim(atom.body)}`);
      }

      const trailerLines = this.formatTrailers(atom, visibleTrailers, displayId);
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
      const label = commitResult.id ?? commitResult.commit.slice(0, 8);
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
      const rootProtocol = this.protocolRegistry.getRoot();
      const state = rootProtocol ? report.atom.protocols.get(rootProtocol.name.toLowerCase()) || report.atom.protocols.get(rootProtocol.name) : null;
      const id = rootProtocol ? getProtocolIdentity(state, rootProtocol) : report.atom.commitHash.slice(0, 8);

      const dateStr = report.atom.date.toISOString().slice(0, 10);
      lines.push(`${this.c.yellow('STALE')}  ${this.c.bold(id || '')} (${dateStr})`);
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
    const rootProtocol = this.protocolRegistry.getRoot();
    const state = rootProtocol ? data.root.protocols.get(rootProtocol.name.toLowerCase()) || data.root.protocols.get(rootProtocol.name) : null;
    const rootId = rootProtocol ? getProtocolIdentity(state, rootProtocol) : data.root.commitHash.slice(0, 8);

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
      lines.push(this.c.bold(`Active Protocol Config (v${data.version})`));
      lines.push(this.c.dim(`Permissive: ${data.permissive}`));
      lines.push('');

      for (const [key, def] of Object.entries(data.trailers)) {
          const isCore = def.isCore;
          if (data.filters.showCore && !isCore) continue;
          if (data.filters.showCustom && isCore) continue;

          const colorName = def.ui?.color || 'dim';
          const color = this.getTrailerColor(colorName);
          lines.push(`${color(key + ':')} ${def.description}`);
          if (def.validation === 'values' && def.values) {
              lines.push(this.c.dim(`  Allowed values: ${Object.keys(def.values).join(', ')}`));
          }
      }

      return lines.join('\n');
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

  private formatTrailers(atom: Atom, visibleTrailers: readonly string[] | 'all', headerId: string): string[] {
    const lines: string[] = [];
    const shouldShow = (key: string): boolean => {
      if (visibleTrailers === 'all') return true;
      return visibleTrailers.includes(key);
    };

    for (const [pName, state] of atom.protocols) {
      const p = this.protocolRegistry.get(pName);
      
      for (const [key, values] of Object.entries(state.trailers)) {
        if (p && key === p.identityKey && p.getIdentity(state) === headerId) continue;
        if (!shouldShow(key)) continue;

        if (!values || values.length === 0) continue;

        const def = p?.getDefinition(key);
        const colorName = def?.ui?.color || 'dim';
        const color = this.getTrailerColor(colorName);
        
        // Engine Baseline: ALWAYS prefix trailers with the protocol name in text format.
        const label = `[${pName}] ${key}`;

        for (const val of values) {
          lines.push(`${this.c.dim(label + ':')} ${val}`);
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
