import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigLoader } from '../../../../src/engine/services/config-loader.js';
import { MOCK_CONFIG } from '../test-utils.js';

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const MOCK_ID_KEY = "Mock-id";

describe('ConfigLoader', () => {
  let loader: ConfigLoader;
  let tempDir: string;

  beforeEach(async () => {
    loader = new ConfigLoader('.mock', 'config.toml', MOCK_CONFIG);
    tempDir = await mkdtemp(join(tmpdir(), 'engine-config-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a .mock/config.toml file in a directory.
   */
  async function createConfigFile(dir: string, content: string): Promise<string> {
    const mockDir = join(dir, '.mock');
    await mkdir(mockDir, { recursive: true });
    const configPath = join(mockDir, 'config.toml');
    await writeFile(configPath, content, 'utf-8');
    return configPath;
  }

  describe('loadFromFile', () => {
    it('should parse a valid TOML config file', async () => {
      const configPath = await createConfigFile(tempDir, `
[protocol]
version = "2.0"

[trailers]
required = ["Constraint", "Confidence"]
custom = ["Team"]

[validation]
strict = true
maxMessageLines = 100
subjectMaxLength = 80

[stale]
olderThan = "1y"
driftThreshold = 50

[output]
defaultFormat = "json"

[follow]
maxDepth = 5
`);

      const config = await loader.loadFromFile(configPath);

      expect(config.protocol.version).toBe('2.0');
      expect(config.trailers.required).toEqual(['Constraint', 'Confidence']);
      expect(config.trailers.custom).toEqual(['Team']);
      expect(config.validation.strict).toBe(true);
      expect(config.validation.maxMessageLines).toBe(100);
      expect(config.validation.subjectMaxLength).toBe(80);
      expect(config.stale.olderThan).toBe('1y');
      expect(config.stale.driftThreshold).toBe(50);
      expect(config.output.defaultFormat).toBe('json');
      expect(config.follow.maxDepth).toBe(5);
    });

    it('should merge partial config with defaults', async () => {
      const configPath = await createConfigFile(tempDir, `
[protocol]
version = "1.5"
`);

      const config = await loader.loadFromFile(configPath);

      expect(config.protocol.version).toBe('1.5');
      // All other sections should come from defaults
      expect(config.trailers).toEqual(MOCK_CONFIG.trailers);
      expect(config.validation).toEqual(MOCK_CONFIG.validation);
      expect(config.stale).toEqual(MOCK_CONFIG.stale);
      expect(config.output).toEqual(MOCK_CONFIG.output);
      expect(config.follow).toEqual(MOCK_CONFIG.follow);
    });

    it('should use defaults for empty config file', async () => {
      const configPath = await createConfigFile(tempDir, '');

      const config = await loader.loadFromFile(configPath);

      expect(config).toEqual(MOCK_CONFIG);
    });

    it('should handle only stale section', async () => {
      const configPath = await createConfigFile(tempDir, `
[stale]
olderThan = "30d"
driftThreshold = 10
`);

      const config = await loader.loadFromFile(configPath);

      expect(config.stale.olderThan).toBe('30d');
      expect(config.stale.driftThreshold).toBe(10);
      expect(config.protocol).toEqual(MOCK_CONFIG.protocol);
    });

    it('should parse cli section options', async () => {
      const configPath = await createConfigFile(tempDir, `
[cli]
cache = false
update_check = false
`);

      const config = await loader.loadFromFile(configPath);

      expect(config.cli.cache).toBe(false);
      expect(config.cli.updateCheck).toBe(false);
    });

    it('should parse snake_case TOML keys (canonical TOML format)', async () => {
      const configPath = await createConfigFile(tempDir, `
[protocol]
version = "2.0"

[validation]
strict = true
max_message_lines = 100
subject_max_length = 80

[stale]
older_than = "1y"
drift_threshold = 50

[output]
default_format = "json"

[follow]
max_depth = 5
`);

      const config = await loader.loadFromFile(configPath);

      expect(config.protocol.version).toBe('2.0');
      expect(config.validation.strict).toBe(true);
      expect(config.validation.maxMessageLines).toBe(100);
      expect(config.validation.subjectMaxLength).toBe(80);
      expect(config.stale.olderThan).toBe('1y');
      expect(config.stale.driftThreshold).toBe(50);
      expect(config.output.defaultFormat).toBe('json');
      expect(config.follow.maxDepth).toBe(5);
    });

    it('should prefer snake_case over camelCase when both are present', async () => {
      const configPath = await createConfigFile(tempDir, `
[validation]
max_message_lines = 100
maxMessageLines = 50
`);

      const config = await loader.loadFromFile(configPath);

      expect(config.validation.maxMessageLines).toBe(100);
    });

    it('should parse permissive mode and custom definitions', async () => {
      const configPath = await createConfigFile(tempDir, `
[trailers]
permissive = false
custom = ["Team"]

[trailers.definitions.Department]
description = "The department"
multivalue = false
validation = "options"
options = ["Eng", "Prod"]
required = true

[trailers.definitions.Tags]
description = "Topic tags"
multivalue = true
validation = "pattern"
pattern = "^#[a-z]+$"
`);

      const config = await loader.loadFromFile(configPath);

      expect(config.trailers.permissive).toBe(false);
      expect(config.trailers.custom).toEqual(['Team']);
      expect(config.trailers.definitions.Department).toEqual({
        description: 'The department',
        multivalue: false,
        validation: 'values',
        values: {
          Eng: { description: '' },
          Prod: { description: '' },
        },
        pattern: undefined,
        required: true,
        directives: undefined,
      });
    });

    it('should parse UI hints for trailer definitions', async () => {
      const configPath = await createConfigFile(tempDir, `
[trailers.definitions.Department]
description = "The department"
multivalue = false
validation = "options"
options = ["Eng", "Prod"]
ui = { kind = "risk", color = "cyan" }
`);

      const config = await loader.loadFromFile(configPath);

      expect(config.trailers.definitions.Department.ui).toEqual({ kind: 'risk', color: 'cyan' });
    });
  });

  describe('findConfigPath', () => {
    it('should find config in the same directory', async () => {
      await createConfigFile(tempDir, '[protocol]\nversion = "1.0"');

      const result = await loader.findConfigPath(tempDir);

      expect(result).toBe(join(tempDir, '.mock', 'config.toml'));
    });

    it('should return null when no config exists', async () => {
      const result = await loader.findConfigPath(tempDir);

      expect(result).toBeNull();
    });
  });

  describe('loadForPath', () => {
    it('should return defaults when no config file exists', async () => {
      const config = await loader.loadForPath(tempDir);

      expect(config).toEqual(MOCK_CONFIG);
    });

    it('should load config from the nearest .mock/config.toml', async () => {
      await createConfigFile(tempDir, `
[protocol]
version = "2.0"
`);

      const config = await loader.loadForPath(tempDir);

      expect(config.protocol.version).toBe('2.0');
    });

    it('should merge child config over parent config', async () => {
      await createConfigFile(tempDir, `
[protocol]
version = "1.0"
[stale]
olderThan = "1y"
`);

      const childDir = join(tempDir, 'child');
      await createConfigFile(childDir, `
[stale]
olderThan = "30d"
`);

      const config = await loader.loadForPath(childDir);

      expect(config.stale.olderThan).toBe('30d');
      expect(config.protocol.version).toBe('1.0');
    });

    it('should fall back to legacy intent_max_length if subject_max_length is missing', async () => {
      const legacyToml = `
[validation]
intent_max_length = 50
`;
      await createConfigFile(tempDir, legacyToml);
      
      const config = await loader.loadForPath(tempDir);
      expect(config.validation.subjectMaxLength).toBe(50);
    });
  });
});
