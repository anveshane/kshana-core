import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.tsx',
    },
    format: ['esm'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    target: 'node20',
    outDir: 'dist',
  },
  {
    entry: {
      'server/cli': 'src/server/cli.ts',
      'server/index': 'src/server/index.ts',
      'core/llm/index': 'src/core/llm/index.ts',
    },
    format: ['cjs'],
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: true,
    target: 'node20',
    outDir: 'dist',
    outExtension() {
      return {
        js: '.cjs',
      };
    },
  },
]);
