import { describe, it, expect, beforeEach } from 'vitest';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import { AtomRepository } from '../../../../src/engine/services/atom-repository.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { SearchFilter } from '../../../../src/engine/services/search-filter.js';
import { NullAtomCache } from '../../../../src/engine/services/atom-cache.js';
import { NullQueryCache } from '../../../../src/engine/services/query-cache.js';
import { MOCK_CONFIG } from '../test-utils.js';

describe('AtomRepository Body Stripping', () => {
  let repo: AtomRepository;
  const protocol = new Protocol({
    name: 'Test',
    version: '1.0',
    identityKey: 'Id',
    namespace: '',
    trailers: {
      'Id': { description: 'ID', multivalue: false, validation: 'none' as const },
      'Key': { description: 'Key', multivalue: false, validation: 'none' as const }
    }
  }, MOCK_CONFIG);

  beforeEach(() => {
    const registry = new ProtocolRegistry();
    registry.register(protocol);
    repo = new AtomRepository(
      {} as any,
      new TrailerParser(),
      registry,
      new SearchFilter(registry),
      new NullAtomCache(),
      new NullQueryCache()
    );
  });

  const strip = (body: string, trailers: string) => (repo as any).stripTrailersFromBody(body, trailers);

  it('should strip trailers with varying whitespace', () => {
    const trailers = 'Id: 12345678\nKey: value';
    const body = 'Actual message.\n\n   Id: 12345678  \n Key: value \n\n';
    expect(strip(body, trailers)).toBe('Actual message.');
  });

  it('should handle trailers indented with tabs', () => {
    const trailers = 'Id: 12345678\nKey: value';
    const body = 'Actual message.\n\n\tId: 12345678\n\tKey: value';
    expect(strip(body, trailers)).toBe('Actual message.');
  });

  it('should NOT strip trailers if they appear in the middle of the body', () => {
    const trailers = 'Id: 12345678\nKey: value';
    const body = 'Message with Id: 12345678 inside it.\n\nMore text.';
    expect(strip(body, trailers)).toBe(body.trim());
  });

  it('should handle multi-value trailers correctly', () => {
    const trailers = 'Id: 123\nKey: v1\nKey: v2';
    const body = 'Subject.\n\nId: 123\nKey: v1\nKey: v2';
    expect(strip(body, trailers)).toBe('Subject.');
  });

  it('should return empty string if body is identical to trailers', () => {
    const trailers = 'Id: 12345678\nKey: val';
    const body = '  Id: 12345678\nKey: val  ';
    expect(strip(body, trailers)).toBe('');
  });

  it('should handle CRLF line endings in trailers', () => {
    const trailers = 'Id: 123\r\nKey: val';
    const body = 'Message.\n\nId: 123\nKey: val';
    expect(strip(body, trailers)).toBe('Message.');
  });
});
