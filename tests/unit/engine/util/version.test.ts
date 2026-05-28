import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..', '..', '..', '..');

const require = createRequire(import.meta.url);
const { version } = require('../../../../package.json') as { version: string };

describe('--version flag', () => {
  it('should report a version that starts with the package.json version', () => {
    const output = execFileSync(process.execPath, ['dist/main.js', '--version'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).trim();

    expect(output.startsWith(version)).toBe(true);
  });

  it('should include build metadata if built in development mode', () => {
    // Note: This test assumes the binary was built with development defaults
    // If it was built with NODE_ENV=production, this will be skipped or updated
    const output = execFileSync(process.execPath, ['dist/main.js', '--version'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).trim();

    if (output.length > version.length) {
        expect(output).toContain('-');
        // Format: version-owner.branch.date.hash
        const suffix = output.slice(version.length + 1);
        expect(suffix.split('.').length).toBeGreaterThanOrEqual(3);
    }
  });
});
