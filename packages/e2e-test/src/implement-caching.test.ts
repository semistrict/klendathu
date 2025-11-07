/**
 * Test transcript caching in implement() mode
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { implement } from 'klendathu';
import { z } from 'zod';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

describe('implement() caching', () => {
  let tempCacheDir: string;

  beforeEach(() => {
    tempCacheDir = mkdtempSync(join('/tmp', 'klendathu-cache-'));
  });

  afterEach(() => {
    if (tempCacheDir && existsSync(tempCacheDir)) {
      rmSync(tempCacheDir, { recursive: true, force: true });
    }
  });

  it('should cache transcript and reuse from cache on second call', async () => {
    const schema = { result: z.number() };
    const prompt = 'Return the number 42';

    // Set cache directory to temp dir
    const oldEnv = process.env.KLENDATHU_CACHE;
    process.env.KLENDATHU_CACHE = tempCacheDir;

    try {
      // First run - creates cache
      console.log('First run (creating cache)...');
      const result1 = await implement(prompt, {}, schema);
      expect(result1.result).toBe(42);

      // Verify cache was created
      const cacheFiles = readdirSync(tempCacheDir);
      expect(cacheFiles.length).toBe(1);
      console.log(`Cache file created: ${cacheFiles[0]}`);

      // Second run - must use cache
      console.log('Second run (using cache with forceUseCache: true)...');
      const result2 = await implement(prompt, {}, schema, { forceUseCache: true });
      expect(result2.result).toBe(42);

      console.log('Cache test passed!');
    } finally {
      // Restore original env
      if (oldEnv !== undefined) {
        process.env.KLENDATHU_CACHE = oldEnv;
      } else {
        delete process.env.KLENDATHU_CACHE;
      }
    }
  }, 180000);
});
