import { TextFormatter } from '../../engine/formatters/text-formatter.js';
import type { ProtocolRegistry } from '../../engine/services/protocol-registry.js';

/**
 * Lore-specific Text Formatter.
 * 
 * Extends the agnostic engine formatter to provide Lore-specific branding 
 * and success messages.
 */
export class LoreTextFormatter extends TextFormatter {
  constructor(
    protocolRegistry: ProtocolRegistry,
    options: { color: boolean; subjectLabel: string }
  ) {
    super(protocolRegistry, options);
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
}
