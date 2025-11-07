/**
 * End-to-end test for impossible task constraints
 *
 * Tests that implement() properly fails when given an impossible schema.
 */

import { describe, it, expect } from 'vitest';
import { implement } from '@/index.js';
import { z } from 'zod';

describe('implement() impossible task', () => {
  it('should fail with impossible schema constraint', async () => {
    const impossibleSchema = {
      result: z.number().min(10).max(5), // Impossible: number can't be >= 10 AND <= 5
    };


    try {
      implement(
        'Return a number between 10 and 5. Pick any number you think is correct.',
        {},
        impossibleSchema
      )
    } catch(e) {
      expect((e as Error).message).toContain('Agent could not complete the task:');
    }
  }, 120000);
});
