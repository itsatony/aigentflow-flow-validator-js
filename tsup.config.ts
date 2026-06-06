import { defineConfig } from 'tsup';

// Two separate builds:
//  - the library entry (`.`) is browser-safe: ESM + CJS + types, no Node builtins.
//  - the CLI entry is ESM-only with a shebang, and is the only place Node
//    builtins (node:fs, node:process) are allowed.
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    target: 'es2021',
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: false,
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
  },
]);
