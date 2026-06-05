import { describe, expect,it } from 'vitest';

import { createBaseFormatter, JsonFormatter, TextFormatter } from '../../../../src/engine/cli/formatters/index.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';

describe('Formatter Factory', () => {
  const registry = new ProtocolRegistry();

  it('should create a JsonFormatter when type is json', () => {
    const formatter = createBaseFormatter('json', registry);
    expect(formatter).toBeInstanceOf(JsonFormatter);
  });

  it('should create a TextFormatter when type is text', () => {
    const formatter = createBaseFormatter('text', registry);
    expect(formatter).toBeInstanceOf(TextFormatter);
  });

  it('should pass options to TextFormatter', () => {
      const formatter = createBaseFormatter('text', registry, { color: false });
      expect(formatter).toBeInstanceOf(TextFormatter);
  });
});
