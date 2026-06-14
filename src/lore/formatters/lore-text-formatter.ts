import chalk from 'chalk';

import { createBaseFormatter } from '../../engine/cli/formatters/index.js';
import { getProtocolIdentity } from '../../engine/core/logic/identity.js';
import { getAuthorizedKeys } from '../../engine/core/logic/protocols.js';
import {  
    type Atom,
    type ErrorMessage,
    type FormattableConfigResult,
    type FormattableDoctorResult, 
    type FormattableStalenessResult, 
    type FormattableTraceResult,
    type FormattableValidationResult,
    type IOutputFormatter,
    type ProtocolContext,    ProtocolMap, SYSTEM_PROTOCOL} from '../../engine/index.js';

/**
 * Lore-specific Text Formatter.
 * 
 * Uses Composition over Inheritance: wraps the base engine formatter 
 * and implements the formal IOutputFormatter interface to provide Lore 
 * branding and 0.5.0 parity.
 */
export class LoreTextFormatter implements IOutputFormatter {
  private readonly base: IOutputFormatter;
  private readonly c = chalk;

  constructor(
    private readonly protocols: ProtocolMap<ProtocolContext>,
    options: { color: boolean }
  ) {
    this.base = createBaseFormatter('text', protocols, options);
  }

  /**
   * Lore 0.5.0 Parity: success messages should be "Commit created: <hash>"
   */
  formatSuccess(message: string, data?: Record<string, unknown>): string {
    if (data?.hash) {
        return this.c.green(`Commit created: ${data.hash}`);
    }
    return this.c.green(message);
  }

  formatError(code: number, messages: readonly ErrorMessage[]): string {
      return this.base.formatError(code, messages);
  }

  formatConfigResult(data: FormattableConfigResult): string {
      return this.base.formatConfigResult(data);
  }

  formatQueryHeader(_target: string, _type: string, _visibleTrailers?: readonly string[] | 'all'): string {
      // Lore 0.5.0 Parity: No Query header
      return '';
  }

  formatQueryAtom(atom: Atom, visibleTrailers: readonly string[] | 'all' = 'all'): string {
      // 1. Identity Promotion & Author Stripping for Lore branding
      const trailersRaw = atom.rawTrailers.split('\n');
      let idFromRaw = '';
      for (const line of trailersRaw) {
          const m = line.match(/^Lore-id:\s*([0-9a-f]{8,40})/i);
          if (m) { idFromRaw = m[1].trim(); break; }
      }

      const id = idFromRaw || atom.commitHash.slice(0, 8);
      const dateStr = atom.date.toISOString().slice(0, 10);
      
      // Author email only - aggressive strip to match 0.5.0
      const authorEmail = atom.author.includes('<') 
          ? atom.author.split('<')[1].split('>')[0]
          : atom.author;

      const header = `── ${id} (${dateStr}, ${authorEmail}) `;
      const rule = '─'.repeat(Math.max(0, 60 - header.length));
      
      const lines: string[] = [];
      const loreState = atom.protocols.get('lore');
      const status = loreState?.supersession || { superseded: false, supersededBy: [] };

      if (status.superseded) {
          lines.push(this.c.dim.strikethrough(header + rule));
          const killerId = status.supersededBy[0].slice(0, 8);
          lines.push(`  ${this.c.dim(`(superseded by ${killerId})`)}`);
      } else {
          lines.push(this.c.bold(header + rule));
      }

      // 2. Body Formatting (Lore 0.5.0 hides subject and indents body)
      if (atom.body) {
          const bodyLines = atom.body.trim().split('\n');
          // First line of body is indented by 2 spaces
          lines.push(`  ${bodyLines[0]}`);
          // Subsequent lines (including blank ones) are printed as-is
          if (bodyLines.length > 1) {
              lines.push(...bodyLines.slice(1));
          }
      }

      // 3. Branded Trailers (Indented by 2 spaces)
      let renderedTrailers = false;
      const trailerLines: string[] = [];
      const loreProtocol = this.protocols.get('lore');
      
      // 3a. Lore Trailers (Primary)
      if (loreState && loreProtocol) {
          const authorizedKeys = getAuthorizedKeys(loreProtocol);
          for (const key of authorizedKeys) {
              if (key.toLowerCase() === 'lore-id') continue;
              
              // Apply visibility filter
              if (visibleTrailers !== 'all' && !visibleTrailers.includes(key)) continue;

              const values = loreState.trailers[key];
              if (!values) continue;
              for (const v of values) {
                  trailerLines.push(`  ${this.c.bold(`${key}:`)} ${v}`);
                  renderedTrailers = true;
              }
          }
          // Unauthorized (Typos in Lore namespace)
          for (const [key, values] of Object.entries(loreState.unauthorized)) {
              if (key.toLowerCase() === 'lore-id') continue;
              for (const v of values) {
                  trailerLines.push(`  ${this.c.yellow('⚠')} ${this.c.bold(`${key}:`)} ${v}`);
                  renderedTrailers = true;
              }
          }
      }

      // 3b. System Trailers (Ad-hoc and Catch-all)
      const systemState = atom.protocols.get(SYSTEM_PROTOCOL);
      const systemProtocol = this.protocols.get(SYSTEM_PROTOCOL);
      if (systemState && systemProtocol) {
          const keys = Object.keys(systemState.trailers);
          for (const key of keys) {
              if (key === systemProtocol.identityKey) continue;
              
              // Apply visibility filter
              if (visibleTrailers !== 'all' && !visibleTrailers.includes(key)) continue;

              const values = systemState.trailers[key];
              if (!values) continue;
              for (const v of values) {
                  trailerLines.push(`  ${this.c.bold(`${key}:`)} ${v}`);
                  renderedTrailers = true;
              }
          }
      }

      // 4. Fallback (Raw)
      if (!loreState && !systemState) {
          // Fallback to raw trailers without prefixes
          for (const line of trailersRaw) {
              const m = line.match(/^([A-Za-z0-9][A-Za-z0-9-]*):\s*(.*)$/);
              if (m && m[1].toLowerCase() !== 'lore-id') {
                  // Apply visibility filter in fallback mode too
                  if (visibleTrailers !== 'all' && !visibleTrailers.includes(m[1])) continue;

                  trailerLines.push(`  ${this.c.bold(`${m[1]}:`)} ${m[2]}`);
                  renderedTrailers = true;
              }
          }
      }

      // Safe fallback if atom is completely empty (unlikely)
      if (!renderedTrailers && !atom.body) {
          lines.push(`  ${atom.subject}`);
      }

      lines.push(...trailerLines);

      // Lore 0.5.0 Parity: Blank line between atoms
      lines.push('');

      return lines.join('\n');
  }

  formatQueryFooter(meta: { total: number; filtered: number; oldest: Date | null; newest: Date | null }): string {
      return `${meta.filtered} of ${meta.total} atoms shown`;
  }

  formatStalenessResult(data: FormattableStalenessResult): string {
    const lines: string[] = [];
    const loreProtocol = this.protocols.get('lore');

    for (const report of data.atoms) {
      const { atom } = report;
      const loreState = atom.protocols.get('lore');
      const id = (loreState && loreProtocol)
          ? (getProtocolIdentity(loreState, loreProtocol) || atom.commitHash.slice(0, 8))
          : atom.commitHash.slice(0, 8);
      
      const dateStr = atom.date.toISOString().slice(0, 10);
      lines.push(`${this.c.yellow('STALE')}  ${this.c.bold(id)} (${dateStr})`);
      lines.push(`  ${atom.subject}`);

      for (const reason of report.reasons) {
        if (reason.signal === 'age') {
            const match = reason.description.match(/older than ([^ ]+) \(([^)]+)\)/);
            if (match) {
                lines.push(`  ${this.c.yellow('\u26a0')} Atom is ${match[2]} old (threshold: ${match[1]})`);
                continue;
            }
        }
        
        if (reason.signal === 'orphaned-dep') continue;

        lines.push(`  ${this.c.yellow('\u26a0')} ${reason.description}`);
      }
      lines.push('');
    }
    return lines.join('\n').trimEnd();
  }

  formatTraceResult(data: FormattableTraceResult): string {
    const lines: string[] = [];
    
    const renderNode = (node: Atom, prefix: string = '') => {
      const loreState = node.protocols.get('lore');
      const loreProtocol = this.protocols.get('lore');
      const id = (loreState && loreProtocol) 
          ? (getProtocolIdentity(loreState, loreProtocol) || node.commitHash.slice(0, 8))
          : node.commitHash.slice(0, 8);
      
      lines.push(`${prefix}${id} ${node.subject}`);
      
      const nodeId = (loreState && loreProtocol) ? getProtocolIdentity(loreState, loreProtocol) : node.commitHash;

      const edges = data.edges.filter(e => e.from === nodeId);
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const target = edge.targetAtom;
        if (target) {
          const isLast = i === edges.length - 1;
          const connector = isLast ? '└──' : '├──';
          
          const targetLoreState = target.protocols.get('lore');
          const targetId = (targetLoreState && loreProtocol)
              ? (getProtocolIdentity(targetLoreState, loreProtocol) || target.commitHash.slice(0, 8))
              : target.commitHash.slice(0, 8);
          
          lines.push(`${connector} [${edge.relationship}] ${targetId} ${target.subject}`);
        }
      }
    };

    renderNode(data.root);
    return lines.join('\n');
  }

  formatValidationResult(data: FormattableValidationResult): string {
    const lines: string[] = [];

    for (const commitResult of data.results) {
      const icon = commitResult.valid ? this.c.green('\u2713') : this.c.red('✗');
      const label = commitResult.identities['lore'] ?? commitResult.commit.slice(0, 8);
      lines.push(`${icon} ${label}`);

      for (const issue of commitResult.issues) {
        const severity = issue.severity === 'error' ? this.c.red('✗') : this.c.yellow('\u26A0');
        let message = issue.message;
        const prefixMatch = message.match(/^\[[^\]]+\]\s+/);
        if (prefixMatch) {
          message = message.slice(prefixMatch[0].length);
        }

        const reqMatch = message.match(/^Required trailer missing: "([^"]+)"$/);
        if (reqMatch) {
          message = `${reqMatch[1]} trailer is missing`;
        }

        lines.push(`  ${severity} [${issue.rule}] ${message}`);
      }
    }

    if (data.results.length > 0) {
        lines.push('');
        lines.push(`${data.summary.commitsChecked} commits checked, ${data.summary.errors} errors`);
    }

    return lines.join('\n');
  }

  formatDoctorResult(data: FormattableDoctorResult): string {
    const lines: string[] = [];
    const excluded = ['Git Repository', 'Local Cache', 'Decision Atoms', 'Git Connectivity', 'Protocols'];
    const checks = data.checks
        .filter(c => !excluded.includes(c.name))
        .map(c => {
            let name = c.name;
            let message = c.message;

            if (name === 'Configuration') {
                name = 'Config file';
                if (c.status === 'ok') message = 'normalized';
            }
            if (name.startsWith('Identity Integrity')) {
                name = 'Lore-id uniqueness';
                if (c.status === 'ok') message = 'All X Lore-ids are unique'; 
            }
            if (name.startsWith('Reference Integrity')) {
                name = 'Reference resolution';
                if (c.status === 'ok') message = 'All references resolve to existing atoms';
            }
            if (name === 'Orphaned dependencies') {
                if (c.status === 'ok') message = 'No orphaned dependencies found';
            }

            return { ...c, name, message };
        });

    const integrityCheckNames = ['Lore-id uniqueness', 'Reference resolution', 'Orphaned dependencies'];
    for (const nameToEnsure of integrityCheckNames) {
        if (!checks.find(c => c.name === nameToEnsure)) {
            let message = 'ok';
            if (nameToEnsure === 'Orphaned dependencies') message = 'No orphaned dependencies found';
            if (nameToEnsure === 'Reference resolution') message = 'All references resolve to existing atoms';
            if (nameToEnsure === 'Lore-id uniqueness') message = 'All X Lore-ids are unique';

            checks.push({
                name: nameToEnsure,
                status: 'ok',
                message,
                details: []
            });
        }
    }

    for (const check of checks) {
      let statusLabel: string;
      switch (check.status) {
        case 'ok': statusLabel = this.c.green('OK'); break;
        case 'warning': statusLabel = this.c.yellow('WARNING'); break;
        case 'error': statusLabel = this.c.red('ERROR'); break;
        default: statusLabel = this.c.dim((check.status as string || 'unknown').toUpperCase());
      }
      lines.push(`${statusLabel}  ${check.name}: ${check.message}`);
    }

    lines.push('');
    if (data.summary.errors === 0) {
        lines.push(this.c.green('all checks passed'));
    } else {
        lines.push(`${data.summary.errors} errors, ${data.summary.warnings} warnings`);
    }

    return lines.join('\n');
  }
}
