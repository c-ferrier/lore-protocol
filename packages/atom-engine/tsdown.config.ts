import { defineConfig } from 'tsdown';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

const ATOM_VERSION = pkg.version;

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

const FINAL_ATOM_VERSION = `${ATOM_VERSION}${buildMetadata}`;

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/testing.ts',
    'src/main.ts'
  ],
  format: ['esm'],
  target: 'node22',
  dts: true,
  clean: true,
  sourcemap: true,
  outputOptions: {
    entryFileNames: '[name].js',
  },
  define: {
    __ATOM_VERSION__: JSON.stringify(FINAL_ATOM_VERSION),
    __ATOM_PURE_VERSION__: JSON.stringify(ATOM_VERSION),
    __ATOM_PACKAGE_NAME__: JSON.stringify(pkg.name),
  },
});
