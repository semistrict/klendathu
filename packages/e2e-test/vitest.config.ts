import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 300000, // 300 seconds (5 min) for e2e tests with Claude invocation
  },
});
