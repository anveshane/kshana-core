import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Copy prompts directory to dist
function copyPrompts() {
  const promptsSrc = join(process.cwd(), 'prompts');
  const promptsDest = join(process.cwd(), 'dist', 'prompts');
  
  function copyRecursive(src: string, dest: string) {
    mkdirSync(dest, { recursive: true });
    const entries = readdirSync(src);
    
    for (const entry of entries) {
      const srcPath = join(src, entry);
      const destPath = join(dest, entry);
      const stat = statSync(srcPath);
      
      if (stat.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
  }
  
  copyRecursive(promptsSrc, promptsDest);
}

export default defineConfig([
  // Main CLI entry point (with shebang for CLI use)
  {
    entry: { 'cli': 'src/index.tsx' },
    format: ['esm'],
    dts: false, // No types needed for CLI
    clean: true,
    sourcemap: true,
    target: 'node20',
    outDir: 'dist',
    banner: {
      js: '#!/usr/bin/env node',
    },
    onSuccess: async () => { copyPrompts(); },
  },
  // Main library entry point (without shebang for importing)
  {
    entry: { 'index': 'src/index.tsx' },
    format: ['esm'],
    dts: true,
    clean: false,
    sourcemap: true,
    target: 'node20',
    outDir: 'dist',
    // No banner for library use
    onSuccess: async () => { copyPrompts(); },
  },
  // Server module for programmatic use
  {
    entry: ['src/server/index.ts'],
    format: ['esm'],
    dts: true,
    clean: false,
    sourcemap: true,
    target: 'node20',
    outDir: 'dist/server',
    onSuccess: async () => { copyPrompts(); },
  },
  // Core module exports
  {
    entry: ['src/core/index.ts', 'src/core/llm/index.ts'],
    format: ['esm'],
    dts: true,
    clean: false,
    sourcemap: true,
    target: 'node20',
    outDir: 'dist/core',
    onSuccess: async () => { copyPrompts(); },
  },
]);
