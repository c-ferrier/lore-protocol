import { defineConfig } from 'tsup';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Load package.json for authoritative names/versions
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

/**
 * Build-time version configuration.
 * These will eventually move to separate package.json files when the project is split.
 */
const LORE_COMPAT_VERSION = '0.5.0';
const LORE_VERSION = pkg.version;
const ATOM_VERSION = pkg.version;

// 1. Resolve Build Metadata
let buildMetadata = '';
const timestamp = new Date().toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);

try {
    const cicdTag = process.env.BUILD_TAG || process.env.GITHUB_REF_NAME;
    if (cicdTag) {
        buildMetadata = `+${cicdTag}`;
    } else {
        const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        buildMetadata = `+${timestamp}.${hash}`;
    }
} catch {
    buildMetadata = `+${timestamp}.local`;
}

// 2. Final Baked Strings
const FINAL_ATOM_VERSION = `${ATOM_VERSION}${buildMetadata}`;
const FINAL_LORE_VERSION = `${LORE_COMPAT_VERSION}-${LORE_VERSION}${buildMetadata}`;

export default defineConfig({
  entry: ['src/main.ts', 'src/lore/cli-wrapper.ts'],
  format: ['esm'],
  target: 'node18',
  dts: false,
  clean: true,
  splitting: false,
  sourcemap: true,
  define: {
    __ATOM_VERSION__: JSON.stringify(FINAL_ATOM_VERSION),
    __LORE_VERSION__: JSON.stringify(FINAL_LORE_VERSION),
    __ATOM_PURE_VERSION__: JSON.stringify(ATOM_VERSION),
    __LORE_PURE_VERSION__: JSON.stringify(LORE_VERSION),
    __ATOM_PACKAGE_NAME__: JSON.stringify('atom-engine'),
    __LORE_PACKAGE_NAME__: JSON.stringify(pkg.name),
  },
});
