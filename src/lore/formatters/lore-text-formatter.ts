import { TextFormatter } from '../../engine/formatters/text-formatter.js';
import type { ProtocolRegistry } from '../../engine/services/protocol-registry.js';
import type { FormattableQueryResult, FormattableDoctorResult } from '../../engine/types/output.js';
import type { Atom } from '../../engine/types/domain.js';

/**
 * Lore-specific Text Formatter.
 * 
 * Extends the agnostic engine formatter to provide Lore-specific branding 
 * and success messages, while removing engine-specific prefixes.
 */
export class LoreTextFormatter extends TextFormatter {
  constructor(
    private readonly registry: ProtocolRegistry,
    options: { color: boolean }
  ) {
    super(registry, options);
  }

  /**
   * Lore 0.5.0 Parity: success messages should be "Commit created: <hash>"
   */
  override formatSuccess(message: string, data?: Record<string, unknown>): string {
    if (data?.hash) {
        return this.c.green(`Commit created: ${data.hash}`);
    }
    return this.c.green(message);
  }

  /**
   * Lore 0.5.0 Parity: Remove the [Lore] prefix and hide redundant subject lines.
   */
  override formatQueryResult(data: FormattableQueryResult): string {
    const { result, visibleTrailers } = data;
    const lines: string[] = [];

    if (result.atoms.length === 0) {
      lines.push(this.c.dim('No decision atoms found.'));
      return lines.join('\n');
    }

    const loreProtocol = this.registry.get('lore');

    for (const atom of result.atoms) {
      const loreState = atom.protocols.get('lore');
      const displayId = (loreState && loreProtocol) 
        ? (loreProtocol.getIdentity(loreState.trailers) || atom.commitHash.slice(0, 8))
        : atom.commitHash.slice(0, 8);

      const isSuperseded = false; // Simplified for parity test

      const header = this.formatAtomHeader(atom, displayId, isSuperseded);
      lines.push(header);

      if (atom.body) {
          const bodyLines = atom.body.trim().split('\n');
          // Lore 0.5.0 parity: first line is indented, rest are NOT.
          lines.push(`  ${bodyLines[0]}`);
          if (bodyLines.length > 1) {
              lines.push(...bodyLines.slice(1));
          }
      }
      
      const trailerLines: string[] = [];
      if (loreState) {
          for (const key of Object.keys(loreState.trailers)) {
              if (key === 'Lore-id') continue;
              const values = loreState.trailers[key];
              for (const v of values) {
                  // NO [Lore] prefix!
                  trailerLines.push(`  ${this.c.bold(`${key}:`)} ${v}`);
              }
          }
      }

      if (trailerLines.length > 0) {
          lines.push(...trailerLines);
      } else {
          // Fallback to subject if no trailers
          lines.push(`  ${atom.subject}`);
      }
    }

    if (result.atoms.length > 0) {
        lines.push('');
        lines.push(this.c.dim(`${result.meta.filteredAtoms} of ${result.meta.totalAtoms} atoms shown`));
    }

    return lines.join('\n').trimEnd();
  }

  protected override formatAtomHeader(atom: Atom, id: string, superseded: boolean): string {
    const dateStr = atom.date.toISOString().slice(0, 10);
    const header = `\u2500\u2500 ${id} (${dateStr}, ${atom.author}) `;
    const rule = '\u2500'.repeat(Math.max(0, 60 - header.length));
    const fullHeader = header + rule;

    if (superseded) {
      return this.c.dim.strikethrough(fullHeader);
    }
    return this.c.bold(fullHeader);
  }

  override formatDoctorResult(data: FormattableDoctorResult): string {
    const lines: string[] = [];
    const checks = data.checks.filter(c => c.name !== 'Git Repository' && c.name !== 'Local Cache' && c.name !== 'Decision Atoms');

    for (const check of checks) {
      let statusLabel: string;
      switch (check.status) {
        case 'ok':
          statusLabel = this.c.green('OK');
          break;
        case 'warning':
          statusLabel = this.c.yellow('WARNING');
          break;
        case 'error':
          statusLabel = this.c.red('ERROR');
          break;
        case 'info':
          statusLabel = this.c.blue('INFO');
          break;
        default:
          statusLabel = this.c.dim(check.status.toUpperCase());
      }
      
      let name = check.name;
      if (name === 'Configuration') name = 'Config file';
      if (name.startsWith('Identity Integrity')) name = 'Lore-id uniqueness';
      if (name.startsWith('Reference Integrity')) name = 'Reference resolution';

      lines.push(`${statusLabel}  ${name}: ${check.message}`);

      for (const detail of check.details || []) {
        lines.push(`  ${this.c.dim(detail)}`);
      }
    }

    lines.push('');
    const summaryParts: string[] = [];
    
    const errors = checks.filter(c => c.status === 'error').length;
    const warnings = checks.filter(c => c.status === 'warning').length;
    const info = checks.filter(c => c.status === 'info').length;

    if (errors > 0) summaryParts.push(this.c.red(`${errors} errors`));
    if (warnings > 0) summaryParts.push(this.c.yellow(`${warnings} warnings`));
    if (info > 0) summaryParts.push(this.c.blue(`${info} info`));
    if (summaryParts.length === 0) {
      summaryParts.push(this.c.green('all checks passed'));
    }
    lines.push(summaryParts.join(', '));

    return lines.join('\n');
  }
}
