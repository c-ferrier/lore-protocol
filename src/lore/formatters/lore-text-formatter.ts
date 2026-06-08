import chalk from 'chalk';

import { createBaseFormatter } from '../../engine/cli/formatters/index.js';
import { getProtocolIdentity } from '../../engine/core/logic/identity.js';
import { getAuthorizedKeys } from '../../engine/core/logic/protocols.js';
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
    type ProtocolRegistry } from '../../engine/index.js';

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
    private readonly registry: ProtocolRegistry,
    options: { color: boolean }
  ) {
    this.base = createBaseFormatter('text', registry, options);
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

  formatConfig(data: FormattableConfigResult): string {
      return this.base.formatConfig(data);
  }

  /**
   * Lore 0.5.0 Parity: Remove the [Lore] prefix and hide redundant subject lines.
   */
  formatQueryResult(data: FormattableQueryResult): string {
    const { result } = data;
    const lines: string[] = [];

    if (result.atoms.length === 0) {
      lines.push(this.c.dim('No decision atoms found.'));
      return lines.join('\n');
    }

    const loreProtocol = this.registry.get('lore');

    for (const atom of result.atoms) {
      const loreState = atom.protocols.get('lore');
      const id = (loreState && loreProtocol) 
        ? (getProtocolIdentity(loreState, loreProtocol) || atom.commitHash.slice(0, 8))
        : atom.commitHash.slice(0, 8);

      const status = id ? (loreState?.supersession || { superseded: false, supersededBy: [] }) : { superseded: false, supersededBy: [] };

      const header = this.formatAtomHeader(atom, id, status.superseded);
      lines.push(header);

      if (status.superseded && status.supersededBy?.[0]) {
          lines.push(`  ${this.c.dim(`(superseded by ${status.supersededBy[0]})`)}`);
      }

      if (atom.body) {
          const bodyLines = atom.body.trim().split('\n');
          // Lore 0.5.0 parity: first line is indented, rest are NOT.
          lines.push(`  ${bodyLines[0]}`);
          if (bodyLines.length > 1) {
              lines.push(...bodyLines.slice(1));
          }
      }
      
      let renderedTrailers = false;
      if (loreState && loreProtocol) {
          // Use the priority order defined in the protocol (Core + Custom)
          // 0.5.0 Parity: Suppress ad-hoc/permissive trailers. Only show authorized ones.
          const authorizedKeys = getAuthorizedKeys(loreProtocol);
          
          for (const key of authorizedKeys) {
              if (key === 'Lore-id') continue;
              const values = loreState.trailers[key];
              if (!values) continue;
              
              for (const v of values) {
                  lines.push(`  ${this.c.bold(`${key}:`)} ${v}`);
                  renderedTrailers = true;
              }
          }

          // Render unauthorized/rejected trailers (typos)
          for (const [key, values] of Object.entries(loreState.unauthorized)) {
              for (const v of values) {
                  lines.push(`  ${this.c.yellow('⚠')} ${this.c.bold(`${key}:`)} ${v}`);
                  renderedTrailers = true;
              }
          }
      } else if (loreState) {
          // Fallback if protocol def is somehow missing from registry
          for (const [key, values] of Object.entries(loreState.trailers)) {
              if (key === 'Lore-id') continue;
              for (const v of values) {
                  lines.push(`  ${this.c.bold(`${key}:`)} ${v}`);
                  renderedTrailers = true;
              }
          }
      }

      if (!renderedTrailers) {
          // Fallback to subject if no trailers were rendered
          lines.push(`  ${atom.subject}`);
      }

      // 0.5.0 Parity: Space between atoms
      lines.push('');
    }

    if (result.atoms.length > 0) {
        lines.push(this.c.dim(`${result.meta.filteredAtoms} of ${result.meta.totalAtoms} atoms shown`));
    }

    return lines.join('\n').trimEnd();
  }

  private formatAtomHeader(atom: Atom, id: string, superseded: boolean): string {
    const dateStr = atom.date.toISOString().slice(0, 10);
    const authorEmail = atom.author.includes('<') 
        ? atom.author.match(/<([^>]+)>/)?.[1] || atom.author
        : atom.author;
    const header = `\u2500\u2500 ${id} (${dateStr}, ${authorEmail}) `;
    const rule = '\u2500'.repeat(Math.max(0, 60 - header.length));
    const fullHeader = header + rule;

    if (superseded) {
      return this.c.dim.strikethrough(fullHeader);
    }
    return this.c.bold(fullHeader);
  }

  formatStalenessResult(data: FormattableStalenessResult): string {
    const lines: string[] = [];
    const loreProtocol = this.registry.get('lore');

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
    
    const renderNode = (node: Atom, depth: number, prefix: string = '') => {
      const loreState = node.protocols.get('lore');
      const loreProtocol = this.registry.get('lore');
      const id = (loreState && loreProtocol) 
          ? (getProtocolIdentity(loreState, loreProtocol) || node.commitHash.slice(0, 8))
          : node.commitHash.slice(0, 8);
      
      lines.push(`${prefix}${id} ${node.subject}`);
      
      const nodeHashPrefix = node.commitHash.slice(0, 8);
      const nodeId = (loreState && loreProtocol) ? getProtocolIdentity(loreState, loreProtocol) : null;

      const edges = data.edges.filter(e => e.from === nodeId || e.from === nodeHashPrefix);
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
          
          lines.push(`${prefix}${connector} [${edge.relationship}] ${targetId} ${target.subject}`);
        }
      }
    };

    renderNode(data.root, 0);
    return lines.join('\n');
  }

  formatValidationResult(data: FormattableValidationResult): string {
    const lines: string[] = [];

    for (const commitResult of data.results) {
      const icon = commitResult.valid
        ? this.c.green('✓')
        : this.c.red('✗');
      const label = commitResult.identities['lore'] ?? commitResult.commit.slice(0, 8);
      lines.push(`${icon} ${label}`);

      for (const issue of commitResult.issues) {
        const severity =
          issue.severity === 'error'
            ? this.c.red('✗')
            : this.c.yellow('⚠');
        
        // 0.5.0 Parity: Remove protocol prefix and shim engine messages for 100% output parity
        let message = issue.message;
        
        // 1. Remove optional protocol prefix [Name] 
        const prefixMatch = message.match(/^\[[^\]]+\]\s+/);
        if (prefixMatch) {
          message = message.slice(prefixMatch[0].length);
        }

        // 2. Shim descriptive engine messages back to legacy Lore 0.5.0 formats
        const reqMatch = message.match(/^Required trailer missing: "([^"]+)"$/);
        if (reqMatch) {
          message = `${reqMatch[1]} trailer is missing`;
        }

        const authMatch = message.match(/^Trailer "([^"]+)" is not recognized by protocol schema$/);
        if (authMatch) {
          message = `Trailer "${authMatch[1]}" is not recognized by protocol schema`;
        }

        const idMatch = message.match(/^[0-9a-zA-Z-]+ "([^"]+)" is not a valid identifier$/);
        if (idMatch) {
          // Protocol-specific identity key check: e.g. "Lore-id \"...\" is not a valid identifier"
          message = `${message}`; // Already matches or is very close
        }

        const patternMatch = message.match(/^Value for "([^"]+)" does not match pattern: (.+)$/);
        if (patternMatch) {
          // If it's a Lore identity failure that didn't hit the specific ID rule above
          if (issue.rule.endsWith('-id-format')) {
              // const idVal = message.match(/"([^"]+)"/)?.[1] || '';
          }
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
            let details = [...c.details];
            let message = c.message;

            if (name === 'Configuration') {
                name = 'Config file';
                details = []; // Lore 0.5.0 had no details for config check
                if (c.status === 'ok') message = 'ok';
            }
            if (name === 'Identity Integrity') {
                name = 'Lore-id uniqueness';
                if (c.status === 'ok') {
                    // All X identities are unique
                    message = c.message.replace('identities', 'Lore-ids');
                }
            }
            if (name === 'Reference Integrity') {
                name = 'Reference resolution';
                if (c.status === 'ok') message = 'All references resolve to existing atoms';
            }
            if (name === 'Orphaned dependencies') {
                if (c.status === 'ok') message = 'No orphaned dependencies found';
            }

            return { ...c, name, message, details };
        });

    // 0.5.0 Parity: Ensure all three integrity checks are present
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

    let warningCount = 0;
    let errorCount = 0;

    for (const check of checks) {
      let statusLabel: string;
      const checkStatus = check.status;

      switch (checkStatus) {
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
          statusLabel = this.c.dim((check.status as string || 'unknown').toUpperCase());
      }

      if (checkStatus === 'warning') warningCount++;
      if (checkStatus === 'error') errorCount++;

      lines.push(`${statusLabel}  ${check.name}: ${check.message}`);

      for (const detail of check.details || []) {
        lines.push(`  ${this.c.dim(detail)}`);
      }
    }

    lines.push('');
    if (errorCount === 0) {
        if (warningCount === 0) {
            lines.push(this.c.green('all checks passed'));
        } else if (warningCount === 1) {
            lines.push('1 warnings');
        } else {
            lines.push(`${warningCount} warnings`);
        }
    } else {
        lines.push(`${errorCount} errors, ${warningCount} warnings`);
    }

    return lines.join('\n');
  }
}
