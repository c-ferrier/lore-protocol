import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Validator } from '../../../../src/engine/services/validator.js';
import { ProtocolRegistry } from '../../../../src/engine/services/protocol-registry.js';
import { Protocol } from '../../../../src/engine/services/protocol.js';
import { TrailerParser } from '../../../../src/engine/services/trailer-parser.js';
import {
  TEST_PROTOCOL_DEFINITION,
  TEST_ENGINE_CONFIG,
  makeProtocol,
  makeProtocolConfig,
  TEST_PROTOCOL_CONFIG
} from '../test-utils.js';

import type { EngineConfig, ProtocolConfig } from '../../../../src/engine/types/config.js';
import type { RawCommit } from '../../../../src/engine/interfaces/git-client.js';
import type { Trailers } from '../../../../src/engine/types/domain.js';
import type { AtomRepository } from '../../../../src/engine/services/atom-repository.js';

const TEST_ID_KEY = "Mock-id";

function createMockAtomRepository(): Partial<AtomRepository> {
  return {
    findById: vi.fn(async () => null),
    findByIds: vi.fn(async () => []),
  };
}

function makeCommit(overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    hash: overrides.hash ?? 'abc1234567890',
    date: overrides.date ?? '2025-01-15T10:00:00Z',
    author: overrides.author ?? 'alice@example.com',
    subject: overrides.subject ?? 'feat(auth): add login flow',
    body: overrides.body ?? '',
    trailers: overrides.trailers ?? `${TEST_ID_KEY}: a1b2c3d4`,
  };
}

describe('Validator', () => {
  let validator: Validator;
  let trailerParser: TrailerParser;
  let mockAtomRepo: Partial<AtomRepository>;
  let engineConfig: EngineConfig;
  let protocolRegistry: ProtocolRegistry;

  beforeEach(() => {
    trailerParser = new TrailerParser();
    mockAtomRepo = createMockAtomRepository();
    engineConfig = { ...TEST_ENGINE_CONFIG };

    protocolRegistry = new ProtocolRegistry();
    protocolRegistry.register(makeProtocol(TEST_PROTOCOL_DEFINITION));
    validator = new Validator(trailerParser, mockAtomRepo as any, engineConfig, protocolRegistry);
  });

  describe('basic validation', () => {
    it('should return valid for a correct commit', async () => {
      const commit = makeCommit();
      const results = await validator.validate([commit]);

      expect(results).toHaveLength(1);
      expect(results[0].valid).toBe(true);
      expect(results[0].issues).toEqual([]);
      expect(results[0].id).toBe('a1b2c3d4');
    });

    it('should validate multiple commits', async () => {
      const commit1 = makeCommit({ hash: 'aaa111' });
      const commit2 = makeCommit({ hash: 'bbb222' });
      const results = await validator.validate([commit1, commit2]);

      expect(results).toHaveLength(2);
    });
  });

  describe('Rule 1: trailer format', () => {
    it('should error when trailers cannot be parsed', async () => {
      vi.spyOn(trailerParser, 'parse').mockImplementation(() => {
        throw new Error('Parse error');
      });

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      expect(results[0].valid).toBe(false);
      const formatIssue = results[0].issues.find((i) => i.rule === 'trailer-format');
      expect(formatIssue).toBeDefined();
      expect(formatIssue!.severity).toBe('error');
    });
  });

  describe('Hygiene rules', () => {
    it('should warn when subject exceeds max length', async () => {
      const longSubject = 'a'.repeat(TEST_ENGINE_CONFIG.validation.subjectMaxLength + 1);
      const commit = makeCommit({ subject: longSubject });
      const results = await validator.validate([commit]);

      const issue = results[0].issues.find((i) => i.rule === 'subject-length');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('warning');
    });

    it('should warn when total message lines exceed max', async () => {
      const manyLines = '\n'.repeat(TEST_ENGINE_CONFIG.validation.maxMessageLines + 1);
      const commit = makeCommit({ body: manyLines });
      const results = await validator.validate([commit]);

      const issue = results[0].issues.find((i) => i.rule === 'message-length');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('warning');
    });

    it('should warn when a trailer appears too many times (cardinality hygiene)', async () => {
      const commit = makeCommit({ trailers: 'Constraint: 1\nConstraint: 2\nConstraint: 3\nConstraint: 4\nConstraint: 5\nConstraint: 6' });
      const results = await validator.validate([commit]);

      const issue = results[0].issues.find((i) => i.rule === 'trailer-count');
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('warning');
      expect(issue?.message).toContain('High count of "Constraint" trailers');
    });
  });

  describe(`Rule 2: ${TEST_ID_KEY} present`, () => {
    it(`should error when ${TEST_ID_KEY} is missing`, async () => {
      const commit = makeCommit({ trailers: 'Constraint: test' });
      const results = await validator.validate([commit]);

      const idIssue = results[0].issues.find((i) => i.rule === 'mock-id-present');
      expect(idIssue).toBeDefined();
      expect(idIssue!.severity).toBe('error');
    });
  });

  describe(`Rule 3: ${TEST_ID_KEY} format`, () => {
    it(`should error when ${TEST_ID_KEY} is not 8-char hex`, async () => {
      const commit = makeCommit({ trailers: `${TEST_ID_KEY}: not-hex!` });
      const results = await validator.validate([commit]);

      const formatIssue = results[0].issues.find((i) => i.rule === 'mock-id-format');
      expect(formatIssue).toBeDefined();
      expect(formatIssue!.severity).toBe('error');
    });

    it(`should pass for valid 8-char hex ${TEST_ID_KEY}`, async () => {
      const commit = makeCommit({ trailers: `${TEST_ID_KEY}: abcd1234` });
      const results = await validator.validate([commit]);

      const formatIssue = results[0].issues.find((i) => i.rule === 'mock-id-format');
      expect(formatIssue).toBeUndefined();
    });

    it(`should error for too-short ${TEST_ID_KEY}`, async () => {
      const commit = makeCommit({ trailers: `${TEST_ID_KEY}: abc123` });
      const results = await validator.validate([commit]);

      const formatIssue = results[0].issues.find((i) => i.rule === 'mock-id-format');
      expect(formatIssue).toBeDefined();
    });

    it(`should error for uppercase hex ${TEST_ID_KEY}`, async () => {
      const commit = makeCommit({ trailers: `${TEST_ID_KEY}: ABCD1234` });
      const results = await validator.validate([commit]);

      const formatIssue = results[0].issues.find((i) => i.rule === 'mock-id-format');
      expect(formatIssue).toBeDefined();
    });
  });

  describe('Rule: invalid-cardinality', () => {
    it('should error when a single-value core trailer has multiple values', async () => {
      const commit = makeCommit({ trailers: 'Confidence: low\nConfidence: high' });
      const results = await validator.validate([commit]);

      const cardinalityIssue = results[0].issues.find((i) => i.rule === 'invalid-cardinality');
      expect(cardinalityIssue).toBeDefined();
      expect(cardinalityIssue!.severity).toBe('error');
      expect(cardinalityIssue!.field).toBe('Confidence');
    });

    it('should error when a single-value custom trailer has multiple values', async () => {
      const customRegistry = new ProtocolRegistry();
      const customProtocol = makeProtocol(TEST_PROTOCOL_DEFINITION, {
        strict: false,
        permissive: true,
        trailers: {
            Team: { description: 'T', multivalue: false, validation: 'none' as const }
        }
      });
      customRegistry.register(customProtocol);
      const customValidator = new Validator(trailerParser, mockAtomRepo as any, TEST_ENGINE_CONFIG, customRegistry);

      const commit = makeCommit({ trailers: 'Team: Engineering\nTeam: Product' });
      const results = await customValidator.validate([commit]);

      const cardinalityIssue = results[0].issues.find((i) => i.rule === 'invalid-cardinality');
      expect(cardinalityIssue).toBeDefined();
      expect(cardinalityIssue!.field).toBe('Team');
    });

    it('should pass when an array core trailer has multiple values', async () => {
      const commit = makeCommit({ trailers: 'Constraint: C1\nConstraint: C2' });
      const results = await validator.validate([commit]);

      const cardinalityIssue = results[0].issues.find((i) => i.rule === 'invalid-cardinality');
      expect(cardinalityIssue).toBeUndefined();
    });
  });

  describe('Rule 4: valid enum values', () => {
    it('should error on invalid Confidence', async () => {
      const commit = makeCommit({ trailers: 'Confidence: super-high' });
      const results = await validator.validate([commit]);

      const enumIssue = results[0].issues.find(
        (i) => i.rule === 'invalid-enum' && i.message.includes('Confidence'),
      );
      expect(enumIssue).toBeDefined();
      expect(enumIssue!.severity).toBe('error');
    });

    it('should accept valid enum values', async () => {
      const commit = makeCommit({ trailers: 'Confidence: medium' });
      const results = await validator.validate([commit]);

      const enumIssues = results[0].issues.filter((i) => i.rule === 'invalid-enum');
      expect(enumIssues).toHaveLength(0);
    });

    it('should not error when enum trailers are empty', async () => {
      const commit = makeCommit({ trailers: 'Constraint: test' });
      const results = await validator.validate([commit]);

      const enumIssues = results[0].issues.filter((i) => i.rule === 'invalid-enum');
      expect(enumIssues).toHaveLength(0);
    });
  });

  describe('Rule 5: subject length', () => {
    it('should warn when subject exceeds max length', async () => {
      const commit = makeCommit({ subject: 'a'.repeat(100) });
      const results = await validator.validate([commit]);

      const issue = results[0].issues.find((i) => i.rule === 'subject-length');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
    });

    it('should not warn when subject is within limit', async () => {
      const commit = makeCommit({ subject: 'feat: short' });
      const results = await validator.validate([commit]);

      const issue = results[0].issues.find((i) => i.rule === 'subject-length');
      expect(issue).toBeUndefined();
    });

    it('should use config value for max length', async () => {
      const customConfig: EngineConfig = {
        ...TEST_ENGINE_CONFIG,
        validation: { ...TEST_ENGINE_CONFIG.validation, subjectMaxLength: 50 },
      };
      const customRegistry = new ProtocolRegistry();
      customRegistry.register(makeProtocol(TEST_PROTOCOL_DEFINITION));
      const customValidator = new Validator(trailerParser, mockAtomRepo as any, customConfig, customRegistry);

      const commit = makeCommit({ subject: 'a'.repeat(51) });
      const results = await customValidator.validate([commit]);

      const issue = results[0].issues.find((i) => i.rule === 'subject-length');
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('50');
    });
  });

  describe('Rule 6: required trailers', () => {
    it('should warn on missing required trailers (non-strict)', async () => {
      const requiredRegistry = new ProtocolRegistry();
      requiredRegistry.register(makeProtocol(TEST_PROTOCOL_DEFINITION, {
        strict: false,
        trailers: { 
            Confidence: { description: '', multivalue: false, validation: 'none', required: true },
            Constraint: { description: '', multivalue: true, validation: 'none', required: true }
        }
      }));
      const requiredValidator = new Validator(trailerParser, mockAtomRepo as any, TEST_ENGINE_CONFIG, requiredRegistry);
      
      const commit = makeCommit({ trailers: `${TEST_ID_KEY}: abc` }); // Missing Confidence and Constraint
      const results = await requiredValidator.validate([commit]);

      const requiredIssues = results[0].issues.filter(
        (i) => i.rule === 'required-trailer',
      );
      expect(requiredIssues).toHaveLength(2);
      expect(requiredIssues[0].severity).toBe('warning');
    });

    it('should error on missing required trailers (strict)', async () => {
      const strictRegistry = new ProtocolRegistry();
      strictRegistry.register(makeProtocol(TEST_PROTOCOL_DEFINITION, {
        strict: true,
        trailers: { 
            Confidence: { description: '', multivalue: false, validation: 'none', required: true }
        }
      }));
      const strictValidator = new Validator(trailerParser, mockAtomRepo as any, TEST_ENGINE_CONFIG, strictRegistry);
      
      const commit = makeCommit({ trailers: `${TEST_ID_KEY}: abc` }); // Missing Confidence
      const results = await strictValidator.validate([commit]);

      const requiredIssues = results[0].issues.filter(
        (i) => i.rule === 'required-trailer',
      );
      expect(requiredIssues).toHaveLength(1);
      expect(requiredIssues[0].severity).toBe('error');
    });

    it('should not warn when required trailers are present', async () => {
      const requiredRegistry = new ProtocolRegistry();
      requiredRegistry.register(makeProtocol(TEST_PROTOCOL_DEFINITION, {
        trailers: { 
            Confidence: { description: '', multivalue: false, validation: 'none', required: true }
        }
      }));
      const requiredValidator = new Validator(trailerParser, mockAtomRepo as any, TEST_ENGINE_CONFIG, requiredRegistry);
      
      const commit = makeCommit({ trailers: `${TEST_ID_KEY}: abc\nConfidence: medium` });
      const results = await requiredValidator.validate([commit]);

      const requiredIssues = results[0].issues.filter(
        (i) => i.rule === 'required-trailer',
      );
      expect(requiredIssues).toHaveLength(0);
    });
  });

  describe('Rule 7: message line count', () => {
    it('should warn when message exceeds max lines', async () => {
      const longBody = Array.from({ length: 55 }, (_, i) => `Line ${i}`).join('\n');
      const commit = makeCommit({ body: longBody });
      const results = await validator.validate([commit]);

      const lineIssue = results[0].issues.find((i) => i.rule === 'message-length');
      expect(lineIssue).toBeDefined();
      expect(lineIssue!.severity).toBe('warning');
    });

    it('should not warn when within line limit', async () => {
      const commit = makeCommit({ body: 'Short body' });
      const results = await validator.validate([commit]);

      const lineIssue = results[0].issues.find((i) => i.rule === 'message-length');
      expect(lineIssue).toBeUndefined();
    });
  });

  describe('Rule 8: reference format', () => {
    it('should warn on invalid reference format (non-strict)', async () => {
      const commit = makeCommit({ trailers: 'Ref: not-hex!\nRelated: toolong12' });
      const results = await validator.validate([commit]);

      const refIssues = results[0].issues.filter(
        (i) => i.rule === 'reference-format',
      );
      expect(refIssues).toHaveLength(2);
      expect(refIssues[0].severity).toBe('warning');
    });

    it('should error on invalid reference format (strict)', async () => {
      const strictRegistry = new ProtocolRegistry();
      strictRegistry.register(makeProtocol(TEST_PROTOCOL_DEFINITION, { strict: true }));
      const strictValidator = new Validator(trailerParser, mockAtomRepo as any, TEST_ENGINE_CONFIG, strictRegistry);
      const commit = makeCommit({ trailers: 'Ref: not-hex!\nRelated: toolong12' });
      const results = await strictValidator.validate([commit]);

      const refIssues = results[0].issues.filter(
        (i) => i.rule === 'reference-format',
      );
      expect(refIssues).toHaveLength(2);
      expect(refIssues[0].severity).toBe('error');
    });

    it('should not warn on valid reference format', async () => {
      vi.mocked(mockAtomRepo.findByIds!).mockResolvedValue([]);
      const commit = makeCommit({ trailers: 'Ref: aabbccdd\nRelated: 11223344' });
      const results = await validator.validate([commit]);

      const refIssues = results[0].issues.filter(
        (i) => i.rule === 'reference-format',
      );
      expect(refIssues).toHaveLength(0);
    });
  });

  describe('Rule 9: trailer count', () => {
    it('should warn when more than 5 of any trailer type', async () => {
      const commit = makeCommit({ trailers: 'Constraint: a\nConstraint: b\nConstraint: c\nConstraint: d\nConstraint: e\nConstraint: f' });
      const results = await validator.validate([commit]);

      const countIssue = results[0].issues.find(
        (i) => i.rule === 'trailer-count',
      );
      expect(countIssue).toBeDefined();
      expect(countIssue!.severity).toBe('warning');
      expect(countIssue!.message).toContain('Constraint');
      expect(countIssue!.message).toContain('6');
    });

    it('should not warn when 5 or fewer of each type', async () => {
      const commit = makeCommit({ trailers: 'Constraint: a\nConstraint: b\nConstraint: c\nConstraint: d\nConstraint: e' });
      const results = await validator.validate([commit]);

      const countIssues = results[0].issues.filter(
        (i) => i.rule === 'trailer-count',
      );
      expect(countIssues).toHaveLength(0);
    });
  });

  describe('overall validity', () => {
    it('should be invalid if any error exists', async () => {
      const commit = makeCommit({ trailers: 'Constraint: some-value' }); // Missing required ID
      const results = await validator.validate([commit]);

      expect(results[0].valid).toBe(false);
    });

    it('should be valid even with warnings', async () => {
      const commit = makeCommit({ subject: 'a'.repeat(100) });
      const results = await validator.validate([commit]);

      // Has a warning but no errors
      const warnings = results[0].issues.filter((i) => i.severity === 'warning');
      const errors = results[0].issues.filter((i) => i.severity === 'error');
      expect(warnings.length).toBeGreaterThan(0);
      expect(errors).toHaveLength(0);
      expect(results[0].valid).toBe(true);
    });
  });

  describe(`commit hash and ${TEST_ID_KEY} reporting`, () => {
    it('should report commit hash', async () => {
      const commit = makeCommit({ hash: 'specific_hash_123' });
      const results = await validator.validate([commit]);

      expect(results[0].commit).toBe('specific_hash_123');
    });

    it(`should report ${TEST_ID_KEY} when present`, async () => {
      const commit = makeCommit({ trailers: `${TEST_ID_KEY}: deadbeef` });
      const results = await validator.validate([commit]);

      expect(results[0].id).toBe('deadbeef');
    });

    it(`should report null ${TEST_ID_KEY} when parse fails`, async () => {
      vi.spyOn(trailerParser, 'parse').mockImplementation(() => {
        throw new Error('Parse error');
      });

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      expect(results[0].id).toBeNull();
    });
  });

  describe('Rule 10: reference existence', () => {
    it('should warn when referenced atom does not exist (non-strict)', async () => {
      const commit = makeCommit({ trailers: 'Ref: aabbccdd' });
      const results = await validator.validate([commit]);

      const refExistsIssues = results[0].issues.filter(
        (i) => i.rule === 'reference-exists',
      );
      expect(refExistsIssues).toHaveLength(1);
      expect(refExistsIssues[0].severity).toBe('warning');
      expect(refExistsIssues[0].message).toContain('aabbccdd');
    });

    it('should error when referenced atom does not exist (strict)', async () => {
      const strictRegistry = new ProtocolRegistry();
      strictRegistry.register(makeProtocol(TEST_PROTOCOL_DEFINITION, { strict: true }));
      const strictValidator = new Validator(trailerParser, mockAtomRepo as any, TEST_ENGINE_CONFIG, strictRegistry);
      const commit = makeCommit({ trailers: 'Ref: aabbccdd' });
      const results = await strictValidator.validate([commit]);

      const refExistsIssues = results[0].issues.filter(
        (i) => i.rule === 'reference-exists',
      );
      expect(refExistsIssues).toHaveLength(1);
      expect(refExistsIssues[0].severity).toBe('error');
      expect(refExistsIssues[0].message).toContain('aabbccdd');
    });

    it('should not warn when referenced atom exists', async () => {
      vi.mocked(mockAtomRepo.findByIds!).mockResolvedValue([{
        commitHash: 'abc',
        date: new Date(),
        author: 'dev@example.com',
        subject: 'test',
        body: '',
        protocols: new Map([
          ['mock', {
            name: 'Mock',
            version: '1.0',
            strict: false,
            permissive: true,
            identityKey: TEST_ID_KEY,
            trailers: { [TEST_ID_KEY]: ['aabbccdd'] },
            unauthorized: {}
          }]
        ]),
        filesChanged: [],
      } as any]);
      const commit = makeCommit({ trailers: 'Related: aabbccdd' });
      const results = await validator.validate([commit]);

      const refExistsIssues = results[0].issues.filter(
        (i) => i.rule === 'reference-exists',
      );
      expect(refExistsIssues).toHaveLength(0);
    });
  });

  describe('Rule 11: custom trailer definitions', () => {
    it('should error when a trailer marked as required in definitions is missing', async () => {
      const pConfig: Partial<ProtocolConfig> = {
        strict: false,
        permissive: false,
        trailers: {
            Department: { description: 'dept', multivalue: false, validation: 'none' as const, required: true },
        },
      };
      const customRegistry = new ProtocolRegistry();
      customRegistry.register(makeProtocol(TEST_PROTOCOL_DEFINITION, pConfig));
      const customValidator = new Validator(trailerParser, mockAtomRepo as any, TEST_ENGINE_CONFIG, customRegistry);
      
      const commit = makeCommit({ trailers: `${TEST_ID_KEY}: abc` }); // Missing Department
      const results = await customValidator.validate([commit]);

      const requiredIssues = results[0].issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues).toHaveLength(1);
      expect(requiredIssues[0].message).toContain('Department');
    });

    it('should error on invalid enum value for custom trailer', async () => {
      const pConfig: Partial<ProtocolConfig> = {
        strict: false,
        permissive: false,
        trailers: {
            Team: {
              description: 'team',
              multivalue: false,
              validation: 'values',
              values: { Alpha: { description: '' }, Beta: { description: '' } },
            },
        },
      };
      const customRegistry = new ProtocolRegistry();
      customRegistry.register(makeProtocol(TEST_PROTOCOL_DEFINITION, pConfig));
      const customValidator = new Validator(trailerParser, mockAtomRepo as any, TEST_ENGINE_CONFIG, customRegistry);

      const commit = makeCommit({ trailers: 'Team: Gamma' });
      const results = await customValidator.validate([commit]);

      const enumIssues = results[0].issues.filter((i) => i.rule === 'invalid-enum');
      expect(enumIssues).toHaveLength(1);
      expect(enumIssues[0].message).toContain('Alpha, Beta');
    });

    it('should error on invalid pattern for custom trailer', async () => {
      const pConfig: Partial<ProtocolConfig> = {
        strict: false,
        permissive: false,
        trailers: {
            Ticket: { description: 'jira', multivalue: false, validation: 'pattern', pattern: '^PROJ-[0-9]+$' },
        },
      };
      const customRegistry = new ProtocolRegistry();
      customRegistry.register(makeProtocol(TEST_PROTOCOL_DEFINITION, pConfig));
      const customValidator = new Validator(trailerParser, mockAtomRepo as any, TEST_ENGINE_CONFIG, customRegistry);

      const commit = makeCommit({ trailers: 'Ticket: invalid-123' });
      const results = await customValidator.validate([commit]);

      const formatIssues = results[0].issues.filter((i) => i.rule === 'invalid-format');
      expect(formatIssues).toHaveLength(1);
      expect(formatIssues[0].message).toContain('does not match pattern');
    });
  });

  describe('Namespacing TYPOS', () => {
      it('should report unauthorized trailers in a namespaced protocol', async () => {
          const nsRegistry = new ProtocolRegistry();
          const nsProtocol = makeProtocol(
              { 
                ...TEST_PROTOCOL_DEFINITION, 
                name: 'Project', 
                namespace: 'Project', 
                identityKey: 'Id',
                trailers: {
                    ...TEST_PROTOCOL_DEFINITION.trailers,
                    'Id': TEST_PROTOCOL_DEFINITION.trailers[TEST_ID_KEY]
                }
              },
              { strict: true, permissive: false }
          );
          nsRegistry.register(nsProtocol);
          const nsValidator = new Validator(trailerParser, mockAtomRepo as any, engineConfig, nsRegistry);

          const commit = makeCommit({ trailers: 'Project: Id: a1b2c3d4\nProject: Tream: backend' });
          const results = await nsValidator.validate([commit]);

          const issues = results[0].issues.filter(i => i.rule === 'unauthorized-trailer');
          const messages = issues.map(i => i.message).join(' ');
          
          expect(issues.length).toBeGreaterThanOrEqual(1);
          expect(messages).toContain('Tream');
          expect(messages).toContain('not recognized');
          expect(messages).toContain('Project');
      });
  });
});
