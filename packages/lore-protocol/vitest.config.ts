import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'lore-protocol',
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000, // E2E tests can be slow
  },
});
