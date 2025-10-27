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
        // AI SDK packages (will be in node_modules)
        'ai',
        '@ai-sdk/mcp',
        'ai-sdk-provider-claude-code',
        '@modelcontextprotocol/sdk',
        /^@ai-sdk\//,
        'zod',
        /^google-auth-library/,
        /^gcp-metadata/,
        /^@aws-sdk\//,
        /^@anthropic-ai\//,
        /^@azure\//,
        /^@google-cloud\//,
        /^@mistralai\//,
        /^@cohere-ai\//,
        /^groq-sdk/,
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
