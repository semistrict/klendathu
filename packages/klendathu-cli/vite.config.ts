import { defineConfig } from 'vite';
import { resolve } from 'path';
import { builtinModules } from 'module';

export default defineConfig({
  build: {
    ssr: true,
    lib: {
      entry: resolve(__dirname, 'src/cli.ts'),
      formats: ['es'],
      fileName: 'cli',
    },
    rollupOptions: {
      external: [
        // All Node.js built-in modules
        ...builtinModules,
        ...builtinModules.map(m => `node:${m}`),
        // Claude Agent SDK dependencies
        '@anthropic-ai/claude-agent-sdk',
        '@modelcontextprotocol/sdk',
      ],
      output: {
        banner: '#!/usr/bin/env node',
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node18',
    minify: false,
  },
});
