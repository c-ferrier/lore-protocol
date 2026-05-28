import { defineConfig } from 'tsup';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Compute build-time version metadata
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
let buildVersion = pkg.version;

// Only add rich metadata for non-production builds
if (process.env.NODE_ENV !== 'production') {
  try {
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const branch = execSync('git branch --show-current', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    let owner = 'custom';
    try {
      const fullName = execSync('git config user.name', { 
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      if (fullName) {
        const parts = fullName.split(/\s+/);
        const lastName = parts.length > 1 ? parts[parts.length - 1] : parts[0];
        owner = lastName.toLowerCase().replace(/[^a-z0-9]/g, '');
      }
    } catch {
      try {
        const email = execSync('git config user.email', { 
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        if (email) {
          owner = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '.');
        }
      } catch {
        // Fallback
      }
    }

    const suffix = branch ? `${owner}.${branch}` : owner;
    buildVersion = `${pkg.version}-${suffix}.${date}.${hash}`;
  } catch {
    // Fallback to package.json version if git fails
  }
}

export default defineConfig({
  entry: ['src/main.ts', 'src/lore/cli-wrapper.ts'],
  format: ['esm'],
  target: 'node18',
  dts: false,
  clean: true,
  splitting: false,
  sourcemap: true,
  define: {
    LORE_VERSION: JSON.stringify(buildVersion),
  },
});
