import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30000,
  fullyParallel: true,
  workers: 4,
  use: {
    headless: true,
    actionTimeout: 2000,
  },
});
