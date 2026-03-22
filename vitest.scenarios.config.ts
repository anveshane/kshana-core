/**
 * Vitest config for Layer 3 (Scenarios) and Layer 4 (Golden) tests.
 * These are excluded from the default config because they may require
 * an LLM server (LM Studio or cloud API).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/scenarios/**/*.test.ts', 'tests/golden/**/*.test.ts', 'tests/checkpoints/**/*.test.ts'],
    fileParallelism: false,
  },
});
