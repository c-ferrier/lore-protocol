import chalk, { Chalk, type ChalkInstance } from 'chalk';

import type { IOutputFormatter, ErrorMessage } from '../interfaces/output-formatter.js';
import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
  FormattableConfigResult,
  FormattableTrailerDefinition,
} from '../types/output.js';
import type { Atom, AtomId } from '../types/domain.js';
import type { ProtocolRegistry } from '../services/protocol-registry.js';

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
    const { result, supersessionMap, visibleTrailers } = data;
    const lines: string[] = [];

    if (result.atoms.length === 0) {
      lines.push(this.c.dim('No decision atoms found.'));
      return lines.join('\n');
    }

    for (const atom of result.atoms) {
      // Find a representative ID for the header (root preferred)
      const rootProtocol = this.protocolRegistry.getRoot();
      const primaryState = rootProtocol ? atom.protocols.get(rootProtocol.name.toLowerCase()) : null;
      
      let id = rootProtocol?.getIdentity(primaryState?.trailers);
      if (!id) {
          // Try to find ANY protocol identity
          for (const [name, state] of atom.protocols) {
              const p = this.protocolRegistry.get(name);
              id = p?.getIdentity(state.trailers) || undefined;
              if (id) break;
          }
      }

      // Final fallback to shortened commit hash
      const displayId = id || atom.commitHash.slice(0, 8);

      // Determine supersession for the displayId
      const supersession = id ? supersessionMap.get(id) : undefined;
      const isSuperseded = supersession?.superseded ?? false;

      const header = this.formatAtomHeader(atom, displayId, isSuperseded);
      lines.push(header);

      if (isSuperseded && supersession?.supersededBy) {
        lines.push(this.c.dim(`  (superseded by ${supersession.supersededBy})`));
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

    lines.push(
      this.c.dim(
        `${result.meta.filteredAtoms} of ${result.meta.totalAtoms} atoms shown`,
      ),
    );

    return lines.join('\n');
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
      `${data.summary.commitsChecked} commits checked`,
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
    lines.push(summaryParts.join(', '));

    return lines.join('\n');
  }

  formatStalenessResult(data: FormattableStalenessResult): string {
    const lines: string[] = [];

    if (data.atoms.length === 0) {
      lines.push(this.c.green('No stale atoms found.'));
      return lines.join('\n');
    }

    for (const report of data.atoms) {
      const rootProtocol = this.protocolRegistry.getRoot();
      const state = rootProtocol ? report.atom.protocols.get(rootProtocol.name.toLowerCase()) : null;
      const id = rootProtocol?.getIdentity(state?.trailers) || 'Unknown';
      
      const dateStr = this.formatDate(report.atom.date);
      lines.push(
        this.c.yellow('STALE') +
          `  ${this.c.bold(id)} (${dateStr})`,
      );
      lines.push(`  ${this.c.dim(report.atom.subject)}`);
      for (const reason of report.reasons) {
        lines.push(`  ${this.c.yellow('\u26A0')} ${reason.description}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  formatTraceResult(data: FormattableTraceResult): string {
    const lines: string[] = [];

    const rootProtocol = this.protocolRegistry.getRoot();
    const state = rootProtocol ? data.root.protocols.get(rootProtocol.name.toLowerCase()) : null;
    const rootId = rootProtocol?.getIdentity(state?.trailers) || 'Unknown';

    lines.push(
      `${this.c.bold(rootId)} ${this.c.dim(data.root.subject)}`,
    );

    const edgeCount = data.edges.length;
    for (let i = 0; i < edgeCount; i++) {
      const edge = data.edges[i];
      const isLast = i === edgeCount - 1;
      const connector = isLast ? '\u2514\u2500\u2500' : '\u251C\u2500\u2500';
      const relLabel = this.c.dim(`[${edge.relationship}]`);
      
      if (edge.targetAtom) {
        lines.push(
          `${connector} ${relLabel} ${this.c.bold(edge.to)} ${this.c.dim(edge.targetAtom.subject)}`,
        );
      } else {
        lines.push(
          `${connector} ${relLabel} ${this.c.bold(edge.to)} ${this.c.dim('(unresolved)')}`,
        );
      }
    }

    return lines.join('\n');
  }

  formatDoctorResult(data: FormattableDoctorResult): string {
    const lines: string[] = [];

    for (const check of data.checks) {
      let icon: string;
      let statusLabel: string;

      switch (check.status) {
        case 'ok':
          icon = this.c.green('\u2713');
          statusLabel = this.c.green('[OK]');
          break;
        case 'warning':
          icon = this.c.yellow('!');
          statusLabel = this.c.yellow('[WARNING]');
          break;
        case 'error':
          icon = this.c.red('\u2717');
          statusLabel = this.c.red('[ERROR]');
          break;
        case 'info':
          icon = this.c.blue('i');
          statusLabel = this.c.blue('[INFO]');
          break;
      }
      lines.push(`${icon}  ${this.c.bold(`${check.name}:`)} ${check.message} ${statusLabel}`);

      for (const detail of check.details || []) {
        lines.push(`     ${this.c.dim(detail)}`);
      }
    }

    const errors = data.checks.filter(c => c.status === 'error').length;
    const warnings = data.checks.filter(c => c.status === 'warning').length;

    let summary = '';
    if (errors > 0 || warnings > 0) {
        summary = ` (${errors} errors, ${warnings} warnings)`;
    }

    const statusMsg = data.status === 'healthy' 
        ? this.c.green('\nSystem is healthy.') 
        : this.c.red(`\nSystem has issues that require attention.${summary}`);
    
    lines.push(statusMsg);
    return lines.join('\n');
  }

  formatConfig(data: FormattableConfigResult): string {
    const lines: string[] = [];
    const rootProtocol = this.protocolRegistry.getRoot();
    lines.push(this.c.bold(`${rootProtocol?.name || 'Engine'} Configuration`));
    lines.push(this.c.dim(`Permissive mode: ${data.permissive ? 'on' : 'off'}`));
    lines.push('');
    lines.push(this.c.bold('--- Trailer Schema ---'));
    lines.push('');

    const sortedKeys = Object.keys(data.trailers).sort();

    if (data.filters.showCore) {
      lines.push(this.c.bold('Standard Trailers'));
      for (const key of sortedKeys) {
        if (data.trailers[key].isCore) {
          lines.push(this.formatTrailerDefinition(key, data.trailers[key]));
        }
      }
      lines.push('');
    }

    if (data.filters.showCustom) {
      const customKeys = sortedKeys.filter(k => !data.trailers[k].isCore);
      if (customKeys.length > 0) {
        lines.push(this.c.bold('Custom Trailers'));
        for (const key of customKeys) {
          lines.push(this.formatTrailerDefinition(key, data.trailers[key]));
        }
        lines.push('');
      }
    }

    return lines.join('\n').trimEnd();
  }

  formatSuccess(message: string, _data?: Record<string, unknown>): string {
    return this.c.green(message);
  }

  formatError(code: number, messages: readonly ErrorMessage[]): string {
    const lines: string[] = [];

    for (const msg of messages) {
      const prefix =
        msg.severity === 'error'
          ? this.c.red('error')
          : this.c.yellow('warning');
      const field = msg.field ? ` [${msg.field}]` : '';
      lines.push(`${prefix}${field}: ${msg.message}`);
    }

    if (code !== 0) {
      lines.push(this.c.dim(`(exit code ${code})`));
    }

    return lines.join('\n');
  }

  protected formatAtomHeader(atom: Atom, id: AtomId, superseded: boolean): string {
    const dateStr = this.formatDate(atom.date);
    const header = `\u2500\u2500 ${id} (${dateStr}, ${atom.author}) `;
    const rule = '\u2500'.repeat(Math.max(0, 60 - header.length));
    const fullHeader = header + rule;

    if (superseded) {
      return this.c.dim.strikethrough(fullHeader);
    }
    return this.c.bold(fullHeader);
  }

  private formatTrailers(
    atom: Atom,
    visibleTrailers: readonly string[] | 'all',
    headerId: string
  ): string[] {
    const lines: string[] = [];
    const shouldShow = (key: string): boolean => {
      if (visibleTrailers === 'all') return true;
      return visibleTrailers.includes(key);
    };

    // Render ALL protocol interpretations equally
    for (const [name, state] of atom.protocols.entries()) {
      const protocolObj = this.protocolRegistry.get(name);
      const definitions = protocolObj?.getFormattableDefinitions() ?? {};

      for (const key of Object.keys(state.trailers)) {
        // Skip only the ID that is already in the header
        if (key === state.identityKey && protocolObj?.getIdentity(state.trailers) === headerId) {
          continue;
        }
        
        if (!shouldShow(key)) continue;

        const values = state.trailers[key];
        if (!values || values.length === 0) continue;

        const def = definitions[key];
        const colorName = def?.ui?.color || (def ? 'cyan' : 'dim');
        const color = (this.c as any)[colorName] || (def ? this.c.cyan : this.c.dim);

        for (const v of values) {
          // Always prefix in text output to avoid confusion in multi-protocol commits
          lines.push(`${this.c.dim(`[${state.name}]`)} ${color(`${key}:`)} ${v}`);
        }
      }
    }

    return lines;
  }

  private formatTrailerDefinition(key: string, def: FormattableTrailerDefinition): string {
    const lines: string[] = [];
    const label = def.required ? this.c.bold(key) : key;
    const type = def.multivalue ? 'array' : 'string';
    const validation = def.validation !== 'none' ? ` (${def.validation})` : '';

    lines.push(`- ${this.c.cyan(label)} [${type}]${validation}`);
    lines.push(`  ${this.c.dim(def.description)}`);

    if (def.validation === 'values' && def.values) {
      const valueLabels = Object.entries(def.values).map(([k, v]) => (v.description ? `${k}: ${v.description}` : k));
      lines.push(`  Values: ${valueLabels.join(', ')}`);
    } else if (def.validation === 'pattern' && def.pattern) {
      lines.push(`  Pattern: ${def.pattern}`);
    }

    if (def.directives && def.directives.length > 0) {
      for (const d of def.directives) {
        lines.push(`  ${this.c.yellow('\u26A0')} ${d}`);
      }
    }

    return lines.join('\n');
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
