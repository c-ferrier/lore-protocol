import { describe, it, expect } from 'vitest';
import { FlagsInputReader } from '../../../src/engine/services/readers/flags-input-reader.js';
import { JsonFormatter } from '../../../src/engine/formatters/json-formatter.js';
import { MOCK_PROTOCOL_CONFIG } from '../engine/test-utils.js';
import { Protocol } from '../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../src/engine/services/protocol-registry.js';
import { LoreProtocolDefinition } from '../../../src/lore/protocol-definition.js';

import type { CommitCommandOptions } from '../../../src/engine/services/commit-input-resolver.js';
import type { FormattableQueryResult } from '../../../src/engine/types/output.js';
import type { Atom, Trailers } from '../../../src/engine/types/domain.js';

const LORE_ID_KEY = "Lore-id";

/**
 * High-level integration tests for the Lore Protocol's architectural integrity.
 * Verifies that the metadata-driven design correctly flows data from the CLI
 * through to the formatted output.
 */
describe('Protocol Architectural Integrity', () => {
  it('should flow custom trailers from CLI flags to JSON output via metadata', async () => {
    // 1. Setup metadata in config
    const config = {
      ...MOCK_PROTOCOL_CONFIG,
      trailers: {
        ...MOCK_PROTOCOL_CONFIG.trailers,
        definitions: {
          'Ticket-ID': {
            description: 'Issue tracker reference',
            multivalue: true,
            validation: 'pattern' as const,
            pattern: '^[A-Z]+-[0-9]+$',
            ui: { kind: 'reference' as any, color: 'dim' as any },
          },
        },
      },
    };

    const protocol = new Protocol(LoreProtocolDefinition, { version: '1.0', trailers: config.trailers });
    const registry = new ProtocolRegistry();
    registry.register(protocol);

    const options: CommitCommandOptions = {
      subject: 'feat: add stuff',
      'ticket-id': ['PROJ-123', 'PROJ-456'],
    } as any;

    const reader = new FlagsInputReader(options, [protocol]);
    const input = await reader.read();

    // 2. Verify Reader mapped it correctly as a top-level property in root namespace
    const rootInput = input.trailers[''] || {};
    expect(rootInput['Ticket-ID']).toEqual(['PROJ-123', 'PROJ-456']);

    // 3. Simulate Query Result (Core Logic)
    const trailers: Trailers = {
      [LORE_ID_KEY]: ['atom-123'],
      ...rootInput,
    };

    const atom: Atom = {
      commitHash: 'abc',
      date: new Date(),
      author: 'alice',
      subject: input.subject,
      body: '',
      filesChanged: [],
      protocols: new Map([
        ['lore', { 
            name: 'Lore', 
            version: '1.0', 
            identityKey: LORE_ID_KEY, 
            trailers,
            unauthorized: {}
        }]
      ]),
    };

    const data: FormattableQueryResult = {
      result: {
        command: 'context',
        target: 't',
        targetType: 'file',
        atoms: [atom],
        meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
      },
      supersessionMap: new Map(),
      visibleTrailers: 'all',
    };

    // 4. Verify Formatter serializes it correctly
    const formatter = new JsonFormatter(registry);
    const output = JSON.parse(formatter.formatQueryResult(data));
    
    // Key should be CANONICAL in JSON inside the protocol's trailers object
    expect(output.results[0].protocols.lore.trailers['Ticket-ID']).toEqual(['PROJ-123', 'PROJ-456']);
  });

  it('should handle a hybrid flow of core and custom trailers simultaneously', async () => {
    const protocol = new Protocol(LoreProtocolDefinition, { version: '1.0', trailers: MOCK_PROTOCOL_CONFIG.trailers });
    const options: CommitCommandOptions = {
      subject: 'feat',
      confidence: 'high',
      trailer: ['Project-Code:LORE-001'],
    };

    const reader = new FlagsInputReader(options, [protocol]);
    const input = await reader.read();

    // Verify both are captured correctly at top level in root namespace
    const root = input.trailers[''] || {};
    expect(root.Confidence).toEqual(['high']);
    expect(root['Project-Code']).toEqual(['LORE-001']);
  });
});
