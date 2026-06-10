import type { ProtocolMap } from '../../core/models/protocol-map.js';
import type { ProtocolContext } from '../../core/types/protocol-definition.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import { JsonFormatter } from './json-formatter.js';
import { TextFormatter } from './text-formatter.js';

export { JsonFormatter, TextFormatter };

/**
 * Factory function to create a base formatter by type.
 */
export function createBaseFormatter(
    type: 'json' | 'text',
    protocols: ProtocolMap<ProtocolContext>,
    options: { color: boolean } = { color: true }
): IOutputFormatter {
    if (type === 'json') {
        return new JsonFormatter(protocols);
    }
    return new TextFormatter(protocols, options);
}
