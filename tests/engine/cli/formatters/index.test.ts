import { describe, expect,it } from 'vitest';

import { createBaseFormatter, JsonFormatter, TextFormatter } from '../../../../src/engine/cli/formatters/index.js';
import { ProtocolMap } from '../../../../src/engine/core/models/protocol-map.js';
import { type ProtocolContext } from '../../../../src/engine/testing.js';

describe('Formatter Factory', () => {
  const protocols = new ProtocolMap<ProtocolContext>();

  it('should create a JsonFormatter when type is json', () => {
    const formatter = createBaseFormatter('json', protocols);
    expect(formatter).toBeInstanceOf(JsonFormatter);
  });

  it('should create a TextFormatter when type is text', () => {
    const formatter = createBaseFormatter('text', protocols);
    expect(formatter).toBeInstanceOf(TextFormatter);
  });

  it('should pass options to TextFormatter', () => {
      const formatter = createBaseFormatter('text', protocols, { color: false });
      expect(formatter).toBeInstanceOf(TextFormatter);
  });
});
