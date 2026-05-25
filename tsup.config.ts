import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/lore/cli-wrapper.ts'],
  format: ['esm'],
  target: 'node18',
  dts: false,
  clean: true,
  splitting: false,
  sourcemap: true,
});
