import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';
import { JsonFormatter } from './json-formatter.js';
import { TextFormatter } from './text-formatter.js';

export { JsonFormatter, TextFormatter };

/**
 * Factory function to create a base formatter by type.
 */
export function createBaseFormatter(
    type: 'json' | 'text',
    registry: ProtocolRegistry,
    options: { color: boolean } = { color: true }
): IOutputFormatter {
    if (type === 'json') {
        return new JsonFormatter(registry);
    }
    return new TextFormatter(registry, options);
}
