import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.tsx', 'src/server/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  outDir: 'dist',
  banner: {
    js: '#!/usr/bin/env node',
  },
});
