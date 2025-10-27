/**
 * End-to-end test for klendathu
 *
 * This test verifies the full debugging workflow:
 * 1. Creates a real error scenario
 * 2. Calls investigate() with the error and context
 * 3. This spawns the real debugger server and CLI
 * 4. The CLI uses Claude to investigate the error
 * 5. Verifies the investigation completes
 */

import { describe, it, expect } from 'vitest';
import { investigate } from 'klendathu';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

describe('klendathu end-to-end', () => {
  it('should launch debugger and investigate error', async () => {
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const outputDir = `/tmp/klendathu-test-${timestamp}`;
    await mkdir(outputDir, { recursive: true });
    // Simulate a real application error scenario
    const userId = 'user-123';
    const requestData = { username: 'john', email: 'john@example.com' };
    let caughtError: Error | null = null;

    try {
      // This simulates application code that throws an error
      function processUserData(data: any) {
        // Accessing undefined property - common error
        const name = data.profile.name; // data.profile is undefined!
        return name.toUpperCase();
      }

      processUserData(requestData);
    } catch (error) {
      caughtError = error as Error;
    }

    expect(caughtError).toBeTruthy();
    expect(caughtError?.message).toContain("Cannot read");

    // Investigate the error using Claude
    const promise = investigate({
      error: caughtError!,
      userId,
      requestData,
    });

    // Collect stderr messages
    const stderrMessages: any[] = [];
    for await (const message of promise.stderr) {
      stderrMessages.push(message);
    }

    // Claude should investigate and produce analysis
    const analysis = await promise;

    console.log('=== Claude Investigation Output ===');
    console.log(analysis);
    console.log('=== End Output ===');

    expect(analysis.length).toBeGreaterThan(0);
    expect(analysis).toContain('error');

    // Check summary
    const summary = await promise.summary;
    console.log('=== Summary ===');
    console.log(`Turns: ${summary.turns}`);
    console.log(`Finish Reason: ${summary.finishReason}`);
    console.log(`Input Tokens: ${summary.inputTokens}`);
    console.log(`Output Tokens: ${summary.outputTokens}`);
    console.log(`Total Tokens: ${summary.totalTokens}`);
    console.log(`Tool Calls: ${summary.toolCallsCount}`);
    if (summary.reasoningTokens) {
      console.log(`Reasoning Tokens: ${summary.reasoningTokens}`);
    }
    if (summary.cachedInputTokens) {
      console.log(`Cached Input Tokens: ${summary.cachedInputTokens}`);
    }
    if (summary.warnings) {
      console.log(`Warnings: ${summary.warnings.join(', ')}`);
    }

    expect(summary.turns).toBeGreaterThan(0);
    expect(summary.inputTokens).toBeGreaterThan(0);
    expect(summary.outputTokens).toBeGreaterThan(0);
    expect(summary.finishReason).toBe('stop');

    // Write all debugging info to files
    await writeFile(
      join(outputDir, 'analysis.txt'),
      analysis,
      'utf-8'
    );

    await writeFile(
      join(outputDir, 'summary.json'),
      JSON.stringify(summary, null, 2),
      'utf-8'
    );

    await writeFile(
      join(outputDir, 'stderr.json'),
      JSON.stringify(stderrMessages, null, 2),
      'utf-8'
    );

    await writeFile(
      join(outputDir, 'error.json'),
      JSON.stringify({
        message: caughtError?.message,
        stack: caughtError?.stack,
        context: { userId, requestData }
      }, null, 2),
      'utf-8'
    );

    console.log(`\n=== Debug files written to: ${outputDir} ===`);
  });
});
