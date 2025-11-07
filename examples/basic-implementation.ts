/**
 * Example: Basic code implementation with klendathu
 *
 * This demonstrates how to use klendathu to generate code based on
 * a natural language prompt and expected output schema.
 */

import { implement } from 'klendathu';
import { z } from 'zod';

// Define the output schema - Claude will implement code to match this
const greetingSchema = z.object({
  greeting: z.string().describe('A friendly greeting message'),
  name: z.string().describe('The person\'s name'),
});

async function main() {
  // Ask Claude to implement a greeting
  const result = await implement({
    instruction: 'Create a warm greeting message for the person with the given name.',
    schema: greetingSchema,
    context: {
      personName: 'Alice',
    },
  });

  console.log('Implementation result:');
  console.log(result);
  // Output: { greeting: "Hello, Alice! Welcome!", name: "Alice" }
}

main().catch(console.error);
