import { describe, expect,it } from 'vitest';

import { analyzeConfigGaps } from '../../../src/core/logic/config-analyzer.js';
;

describe('analyzeConfigGaps', () => {
  const schema = {
    cache: ['query', 'identity'],
    validation: ['subjectMaxLength']
  };

  const defaults = {
    cache: { query: true, identity: true },
    validation: { subjectMaxLength: 72 }
  };

  it('should return zero gaps for a perfect match', () => {
    const config = {
      cache: { query: true, identity: true },
      validation: { subject_max_length: 72 }
    };
    const result = analyzeConfigGaps(config, schema, defaults);
    expect(result.missing).toHaveLength(0);
    expect(result.customized).toHaveLength(0);
  });

  it('should identify missing sections', () => {
    const config = { cache: { query: true } };
    const result = analyzeConfigGaps(config, schema, defaults);
    expect(result.missing).toContain('[validation] section');
  });

  it('should identify missing keys within a section', () => {
    const config = { 
      cache: { query: true },
      validation: { subject_max_length: 72 }
    };
    const result = analyzeConfigGaps(config, schema, defaults);
    expect(result.missing).toContain('cache.identity');
  });

  it('should identify customized values', () => {
    const config = {
      cache: { query: false, identity: true },
      validation: { subject_max_length: 72 }
    };
    const result = analyzeConfigGaps(config, schema, defaults);
    expect(result.customized).toContain('cache.query');
  });

  it('should respect both snake_case and camelCase', () => {
    const config = {
      cache: { query: true, identity: true },
      validation: { subjectMaxLength: 72 }
    };
    const result = analyzeConfigGaps(config, schema, defaults);
    expect(result.missing).toHaveLength(0);
  });

  it('should identify multiple customized values and missing keys simultaneously', () => {
    const config = {
      cache: { query: false }, // customized, and 'identity' is missing
    };
    const result = analyzeConfigGaps(config, schema, defaults);
    
    expect(result.customized).toContain('cache.query');
    expect(result.missing).toContain('cache.identity');
    expect(result.missing).toContain('[validation] section');
  });
});