import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
    testDir: '.',
    timeout: 30000,
    fullyParallel: true,
    workers: 4,
    use: {
        headless: true,
        actionTimeout: 2000,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
//# sourceMappingURL=playwright.config.js.map