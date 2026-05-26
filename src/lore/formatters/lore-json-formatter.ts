import { JsonFormatter } from '../../engine/formatters/json-formatter.js';
import type { IOutputFormatter, ErrorMessage } from '../../engine/interfaces/output-formatter.js';
import type { 
    FormattableQueryResult, 
    FormattableValidationResult, 
    FormattableStalenessResult, 
    FormattableTraceResult, 
    FormattableDoctorResult, 
    FormattableConfigResult 
} from '../../engine/types/output.js';
import { snakeCase } from '../../util/string.js';
import type { ProtocolRegistry } from '../../engine/services/protocol-registry.js';

/**
 * Lore CLI 0.5.0 Legacy Formatter.
 * 
 * Wraps and transforms the agnostic engine output to maintain perfect 
 * backward compatibility with the original Lore CLI.
 */
export class LoreJsonFormatter implements IOutputFormatter {
  private readonly inner: JsonFormatter;

  constructor(private readonly protocolRegistry: ProtocolRegistry) {
      this.inner = new JsonFormatter(protocolRegistry, 'Intent');
  }

  formatQueryResult(data: FormattableQueryResult): string {
    const agnosticJson = JSON.parse(this.inner.formatQueryResult(data));
    
    // Transform each result to match 0.5.0 flat structure
    agnosticJson.results = agnosticJson.results.map((r: any) => this.toLegacyAtom(r));
    
    // 0.5.0 uses lore_version at the root of the query result
    const loreProtocol = this.protocolRegistry.get('lore');
    if (loreProtocol) {
        agnosticJson.lore_version = loreProtocol.version;
    }

    return JSON.stringify(agnosticJson, null, 2);
  }

  formatValidationResult(data: FormattableValidationResult): string {
    return this.inner.formatValidationResult(data);
  }

  formatStalenessResult(data: FormattableStalenessResult): string {
    const agnosticJson = JSON.parse(this.inner.formatStalenessResult(data));
    agnosticJson.stale_atoms = agnosticJson.stale_atoms.map((r: any) => this.toLegacyAtom(r));
    return JSON.stringify(agnosticJson, null, 2);
  }

  formatTraceResult(data: FormattableTraceResult): string {
    const agnosticJson = JSON.parse(this.inner.formatTraceResult(data));
    agnosticJson.root = this.toLegacyAtom(agnosticJson.root);
    agnosticJson.edges = agnosticJson.edges.map((e: any) => ({
        ...e,
        target_atom: e.target_atom ? this.toLegacyAtom(e.target_atom) : null
    }));
    return JSON.stringify(agnosticJson, null, 2);
  }

  formatDoctorResult(data: FormattableDoctorResult): string {
    return this.inner.formatDoctorResult(data);
  }

  formatSuccess(_message: string, data?: Record<string, unknown>): string {
    const hash = (data?.hash as string) ?? '';
    
    // Lore 0.5.0 Parity: Simple message and populated hash
    const legacyJson: any = {
        lore_version: this.protocolRegistry.get('lore')?.version ?? '1.0',
        success: true,
        message: `Commit created: ${hash}`,
        hash: hash
    };

    return JSON.stringify(legacyJson, null, 2);
  }

  formatError(code: number, messages: readonly ErrorMessage[]): string {
    return this.inner.formatError(code, messages);
  }

  formatConfig(data: FormattableConfigResult): string {
    return this.inner.formatConfig(data);
  }

  /**
   * Transforms a pure engine atom into a flat Lore 0.5.0 atom.
   */
  private toLegacyAtom(agnostic: any): any {
    const legacy: any = { ...agnostic };
    const lore = agnostic.protocols?.lore;

    if (lore) {
        // 1. Lift lore_id to the root
        legacy.lore_id = lore.id;

        // 2. Create flat trailers object with snake_case keys
        legacy.trailers = {};
        for (const [key, value] of Object.entries(lore.trailers)) {
            legacy.trailers[snakeCase(key)] = value;
        }

        // 3. Ensure lore_id is also inside trailers for 0.5.0 parity
        legacy.trailers.lore_id = lore.id;
    }

    return legacy;
  }
}
