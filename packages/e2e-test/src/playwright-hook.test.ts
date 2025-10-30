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

    // Generate random number to verify investigation has page access
    const randomNum = Math.floor(Math.random() * 1000000);

    const result = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>((resolve) => {
      const proc = spawn(
        klendathuCli,
        ['npx', 'playwright', 'test', 'playwright-hook-target.test.ts', '--grep', 'should find random number|multiple extends'],
        {
          cwd: testAppDir,
          env: {
            ...process.env,
            TEST_RANDOM_NUMBER: randomNum.toString(),
          },
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

    // CRITICAL: Verify investigation found the actual random number, proving it has page access
    expect(result.stderr).toContain(`Random: ${randomNum}`);
  }, 120000);
});
