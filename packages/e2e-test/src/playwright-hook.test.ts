import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('playwright-hook', () => {
  it('should intercept Playwright test failures and trigger investigation', async () => {
    const testAppDir = join(__dirname, '..', 'test-app');
    const klendathuCli = join(__dirname, '..', '..', 'klendathu-cli', 'dist', 'cli.js');

    const result = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>((resolve) => {
      const proc = spawn(
        klendathuCli,
        ['npx', 'playwright', 'test', 'playwright-hook-target.test.ts'],
        {
          cwd: testAppDir,
          env: process.env,
        }
      );

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log('[playwright stdout]', data.toString());
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error('[playwright stderr]', data.toString());
      });

      proc.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code || 0 });
      });
    });

    // Test should fail (because the webapp has bugs)
    expect(result.exitCode).not.toBe(0);

    // Should see klendathu investigation output
    expect(result.stderr).toContain('🐛 Playwright step');
    expect(result.stderr).toContain('investigating');
    expect(result.stderr).toContain('📋 Klendathu Investigation');
  }, 400000); // Longer timeout for 4 tests × ~60s each
});
