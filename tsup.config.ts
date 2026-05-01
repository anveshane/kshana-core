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
      // Embed entries — let kshana-desktop (and other Electron hosts)
      // require these CJS bundles directly without dragging in Fastify.
      'server/manager': 'src/server/manager.ts',
      'server/runners/index': 'src/server/runners/index.ts',
      'agent/pi/index': 'src/agent/pi/index.ts',
    },
    format: ['cjs'],
    // Maps import.meta.url to a __filename-based URL in CJS output (avoids empty-import-meta warnings and broken paths).
    shims: true,
    // Emit .d.ts for the CJS bundles so embedded consumers (Electron
    // main process) get types when they require('kshana-ink/manager').
    dts: { entry: {
      'server/manager': 'src/server/manager.ts',
      'server/runners/index': 'src/server/runners/index.ts',
      'agent/pi/index': 'src/agent/pi/index.ts',
      'core/llm/index': 'src/core/llm/index.ts',
    }},
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
