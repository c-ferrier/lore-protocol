import { defineConfig } from 'tsdown';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

const LORE_COMPAT_VERSION = '0.5.0';
const LORE_VERSION = pkg.version;

let buildMetadata = '';
const timestamp = new Date().toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);

try {
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    buildMetadata = `+${timestamp}.${hash}`;
} catch {
    buildMetadata = `+${timestamp}.local`;
}

const FINAL_LORE_VERSION = `${LORE_COMPAT_VERSION}-${LORE_VERSION}${buildMetadata}`;

export default defineConfig({
  entry: [
    'src/cli-wrapper.ts',
  ],
  format: ['esm'],
  target: 'node22',
  dts: true,
  clean: true,
  sourcemap: true,
  outputOptions: {
    entryFileNames: 'index.js',
  },
  define: {
    __LORE_VERSION__: JSON.stringify(FINAL_LORE_VERSION),
    __LORE_PURE_VERSION__: JSON.stringify(LORE_VERSION),
    __LORE_PACKAGE_NAME__: JSON.stringify(pkg.name),
  },
});
