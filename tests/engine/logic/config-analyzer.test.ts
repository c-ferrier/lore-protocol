import { describe, it, expect } from 'vitest';
import { analyzeConfigGaps } from '../../../src/engine/util/config-analyzer.js';

describe('analyzeConfigGaps', () => {
  const schema = {
    cli: ['updateCheck', 'cache'],
    validation: ['subjectMaxLength']
  };

  const defaults = {
    cli: { updateCheck: true, cache: true },
    validation: { subjectMaxLength: 72 }
  };

  it('should return zero gaps for a perfect match', () => {
    const config = {
      cli: { update_check: true, cache: true },
      validation: { subject_max_length: 72 }
    };
    const result = analyzeConfigGaps(config, schema, defaults);
    expect(result.missing).toHaveLength(0);
    expect(result.customized).toHaveLength(0);
  });

  it('should identify missing sections', () => {
    const config = { cli: { cache: true } };
    const result = analyzeConfigGaps(config, schema, defaults);
    expect(result.missing).toContain('[validation] section');
  });

  it('should identify missing keys within a section', () => {
    const config = { 
      cli: { cache: true },
      validation: { subject_max_length: 72 }
    };
    const result = analyzeConfigGaps(config, schema, defaults);
    expect(result.missing).toContain('cli.update_check');
  });

  it('should identify customized values', () => {
    const config = {
      cli: { update_check: false, cache: true },
      validation: { subject_max_length: 72 }
    };
    const result = analyzeConfigGaps(config, schema, defaults);
    expect(result.customized).toContain('cli.update_check');
  });

  it('should respect both snake_case and camelCase', () => {
    const config = {
      cli: { updateCheck: true, cache: true },
      validation: { subjectMaxLength: 72 }
    };
    const result = analyzeConfigGaps(config, schema, defaults);
    expect(result.missing).toHaveLength(0);
  });

  it('should identify multiple customized values and missing keys simultaneously', () => {
    const config = {
      cli: { update_check: false }, // customized, and 'cache' is missing
    };
    const result = analyzeConfigGaps(config, schema, defaults);
    
    expect(result.customized).toContain('cli.update_check');
    expect(result.missing).toContain('cli.cache');
    expect(result.missing).toContain('[validation] section');
  });
});
