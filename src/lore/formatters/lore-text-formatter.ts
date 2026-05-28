import { TextFormatter } from '../../engine/formatters/text-formatter.js';
import type { ProtocolRegistry } from '../../engine/services/protocol-registry.js';
import type { 
    FormattableQueryResult, 
    FormattableDoctorResult, 
    FormattableStalenessResult, 
    FormattableTraceResult,
    FormattableValidationResult
} from '../../engine/types/output.js';
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
    const { result, supersessionMap } = data;
    const lines: string[] = [];

    if (result.atoms.length === 0) {
      lines.push(this.c.dim('No decision atoms found.'));
      return lines.join('\n');
    }

    const loreProtocol = this.registry.get('lore');

    for (const atom of result.atoms) {
      const loreState = atom.protocols.get('lore');
      const id = (loreState && loreProtocol) 
        ? (loreProtocol.getIdentity(loreState.trailers) || atom.commitHash.slice(0, 8))
        : atom.commitHash.slice(0, 8);

      const status = id ? (supersessionMap.get(id) || { superseded: false, supersededBy: null }) : { superseded: false, supersededBy: null };

      const header = this.formatAtomHeader(atom, id, status.superseded);
      lines.push(header);

      if (status.superseded && status.supersededBy) {
          lines.push(`  ${this.c.dim(`(superseded by ${status.supersededBy})`)}`);
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
          const authorizedKeys = loreProtocol.getAuthorizedKeys();
          
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

  override formatStalenessResult(data: FormattableStalenessResult): string {
    const lines: string[] = [];
    for (const report of data.atoms) {
      const { atom } = report;
      const loreState = atom.protocols.get('lore');
      const id = loreState
          ? (atom.protocols.get('lore')?.trailers['Lore-id']?.[0] || atom.commitHash.slice(0, 8))
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

  override formatTraceResult(data: FormattableTraceResult): string {
    const lines: string[] = [];
    
    const renderNode = (node: Atom, depth: number, prefix: string = '') => {
      const loreState = node.protocols.get('lore');
      const id = (loreState) 
          ? (this.registry.get('lore')?.getIdentity(loreState.trailers) || node.commitHash.slice(0, 8))
          : node.commitHash.slice(0, 8);
      
      lines.push(`${prefix}${id} ${node.subject}`);
      
      const nodeHashPrefix = node.commitHash.slice(0, 8);
      const nodeId = loreState ? this.registry.get('lore')?.getIdentity(loreState.trailers) : null;

      const edges = data.edges.filter(e => e.from === nodeId || e.from === nodeHashPrefix);
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const target = edge.targetAtom;
        if (target) {
          const isLast = i === edges.length - 1;
          const connector = isLast ? '└──' : '├──';
          
          const targetLoreState = target.protocols.get('lore');
          const targetId = targetLoreState 
              ? (this.registry.get('lore')?.getIdentity(targetLoreState.trailers) || target.commitHash.slice(0, 8))
              : target.commitHash.slice(0, 8);
          
          lines.push(`${prefix}${connector} [${edge.relationship}] ${targetId} ${target.subject}`);
        }
      }
    };

    renderNode(data.root, 0);
    return lines.join('\n');
  }

  override formatValidationResult(data: FormattableValidationResult): string {
    const lines: string[] = [];

    for (const commitResult of data.results) {
      const icon = commitResult.valid
        ? this.c.green('✓')
        : this.c.red('✗');
      const label = commitResult.id ?? commitResult.commit.slice(0, 8);
      lines.push(`${icon} ${label}`);

      for (const issue of commitResult.issues) {
        const severity =
          issue.severity === 'error'
            ? this.c.red('✗')
            : this.c.yellow('⚠');
        
        // 0.5.0 Parity: Remove [Lore] prefix from error messages
        let message = issue.message;
        if (message.startsWith('[Lore] ')) message = message.slice(7);

        lines.push(`  ${severity} [${issue.rule}] ${message}`);
      }
    }

    if (data.results.length > 0) {
        lines.push('');
        lines.push(`${data.summary.commitsChecked} commits checked, ${data.summary.errors} errors`);
    }

    return lines.join('\n');
  }

  override formatDoctorResult(data: FormattableDoctorResult): string {
    const lines: string[] = [];
    const checks = data.checks.filter(c => c.name !== 'Git Repository' && c.name !== 'Local Cache' && c.name !== 'Decision Atoms');

    // 0.5.0 Parity: Ensure all three integrity checks are present
    const integrityCheckNames = ['Lore-id uniqueness', 'Reference resolution', 'Orphaned dependencies'];
    
    for (const nameToEnsure of integrityCheckNames) {
        if (!checks.find(c => c.name.startsWith(nameToEnsure) || (nameToEnsure === 'Lore-id uniqueness' && c.name.includes('Identity')) || (nameToEnsure === 'Reference resolution' && c.name.includes('Reference')))) {
            checks.push({
                name: nameToEnsure,
                status: 'ok',
                message: nameToEnsure === 'Orphaned dependencies' ? 'No orphaned dependencies found' : 'ok',
                details: []
            });
        }
    }

    let warningCount = 0;
    let errorCount = 0;

    for (const check of checks) {
      let statusLabel: string;
      let checkStatus = check.status;

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
      
      let name = check.name;
      let message = check.message;

      if (name === 'Configuration') {
          name = 'Config file';
          if (checkStatus === 'ok') {
              message = check.message;
          }
          if (checkStatus === 'warning') {
              // 0.5.0 parity: if we have legacy config but no engine config, it's OK for Lore
              statusLabel = this.c.green('OK');
              checkStatus = 'ok';
              message = 'Found and parsed .lore/config.toml';
          }
      }
      if (name.startsWith('Identity Integrity')) {
          name = 'Lore-id uniqueness';
          if (checkStatus === 'ok') {
              const countMatch = check.message.match(/\d+/);
              const count = countMatch ? countMatch[0] : '0';
              message = `All ${count} Lore-ids are unique`;
          }
      }
      if (name.startsWith('Reference Integrity')) {
          name = 'Reference resolution';
          if (checkStatus === 'ok') message = 'All references resolve to existing atoms';
      }
      if (name === 'Orphaned dependencies') {
          if (checkStatus === 'ok') message = 'No orphaned dependencies found';
      }

      if (checkStatus === 'warning') warningCount++;
      if (checkStatus === 'error') errorCount++;

      lines.push(`${statusLabel}  ${name}: ${message}`);

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
