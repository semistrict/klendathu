import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/cli.ts'),
      formats: ['es'],
      fileName: 'cli',
    },
    rollupOptions: {
      external: [
        'ai',
        '@ai-sdk/mcp',
        'ai-sdk-provider-claude-code',
        '@modelcontextprotocol/sdk',
        'node:util',
        'node:child_process',
        'node:path',
        'node:url',
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
