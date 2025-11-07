/**
 * Simple test for implement() with new ephemeral_eval and append_code tools
 */

import { describe, it, expect } from 'vitest';
import { implement } from '@/index.js';
import { z } from 'zod';

describe('implement() simple tests', () => {
  it('should double an array of numbers', async () => {
    const schema = {
      doubled: z.array(z.number()),
    };

    const result = await implement(
      'Double each number in the input array.',
      { numbers: [1, 2, 3, 4, 5] },
      schema
    );

    console.log('Result:', result);
    expect(result.doubled).toEqual([2, 4, 6, 8, 10]);
  }, 120000);

  it('should create a greeting', async () => {
    const schema = {
      greeting: z.string(),
      name: z.string(),
    };

    const result = await implement(
      'Create a greeting message for the person with the given name.',
      { personName: 'Alice' },
      schema
    );

    console.log('Result:', result);
    expect(result.name).toBe('Alice');
    expect(result.greeting).toContain('Alice');
  }, 120000);
});
