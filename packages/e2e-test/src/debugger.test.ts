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

describe('klendathu end-to-end', () => {
  it('should launch debugger and investigate error', async () => {
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
    console.log(`Cost: $${summary.cost}`);
    console.log(`Turns: ${summary.turns}`);

    expect(summary.cost).toBeGreaterThan(0);
    expect(summary.turns).toBeGreaterThan(0);
  });
});
