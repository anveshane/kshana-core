import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Exclude expensive test layers by default (run via dedicated scripts)
    exclude: ['tests/golden/**', 'tests/scenarios/**'],
    // Run test files sequentially to avoid race conditions with shared state (e.g., .kshana directory)
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/index.tsx', 'src/**/*.d.ts'],
    },
  },
});
