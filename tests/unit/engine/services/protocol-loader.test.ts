import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DynamicProtocolLoader } from '../../../../src/engine/services/protocol-loader.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('DynamicProtocolLoader', () => {
  let loader: DynamicProtocolLoader;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'protocol-loader-test-'));
    loader = new DynamicProtocolLoader(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should load multiple protocols from a directory', async () => {
    await writeFile(join(tempDir, 'proto-a.toml'), `
name = "ProtoA"
version = "2.0"
namespace = "a"
identity_key = "a-id"
[trailers.Status]
description = "status"
`);

    await writeFile(join(tempDir, 'proto-b.toml'), `
name = "ProtoB"
[trailers.Team]
description = "team"
`);

    const protocols = await loader.loadAll();
    expect(protocols).toHaveLength(2);
    
    const a = protocols.find(p => p.name === 'ProtoA')!;
    expect(a.version).toBe('2.0');
    expect(a.namespace).toBe('a');
    expect(a.identityKey).toBe('a-id');
    expect(a.trailers.Status).toBeDefined();

    const b = protocols.find(p => p.name === 'ProtoB')!;
    expect(b.namespace).toBe('proto-b'); // Derived from filename slug
    expect(b.identityKey).toBe('ProtoB-id'); // Derived from name
  });

  it('should parse complex trailer definitions with validation and UI', async () => {
    const protoPath = join(tempDir, 'complex.toml');
    await writeFile(protoPath, `
[trailers.Confidence]
description = "certainty"
multivalue = false
validation = "values"
values = { low = "L", high = "H" }
[trailers.Confidence.ui]
kind = "risk"
color = "yellow"

[trailers.Ref]
description = "link"
validation = "pattern"
pattern = "^[0-9a-f]{8}$"
directives = ["follow"]
`);

    const proto = await loader.loadFromFile(protoPath);
    expect(proto).toBeDefined();
    
    const conf = proto!.trailers.Confidence;
    expect(conf.multivalue).toBe(false);
    expect(conf.validation).toBe('values');
    expect(Object.keys(conf.values!)).toEqual(['low', 'high']);
    expect(conf.ui?.kind).toBe('risk');
    expect(conf.ui?.color).toBe('yellow');

    const ref = proto!.trailers.Ref;
    expect(ref.validation).toBe('pattern');
    expect(ref.pattern).toBe('^[0-9a-f]{8}$');
    expect(ref.directives).toEqual(['follow']);
  });

  it('should return empty list if directory does not exist', async () => {
    const nonExistentLoader = new DynamicProtocolLoader(join(tempDir, 'missing'));
    const protocols = await nonExistentLoader.loadAll();
    expect(protocols).toEqual([]);
  });

  it('should throw if a protocol file is corrupt', async () => {
    await writeFile(join(tempDir, 'corrupt.toml'), `[trailers\n name = "missing bracket"`);
    await expect(loader.loadFromFile(join(tempDir, 'corrupt.toml'))).rejects.toThrow(/Failed to load protocol/);
  });
});
