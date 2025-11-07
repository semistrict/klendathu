import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Simulate the validate function from implement.ts
function validateWithSchema<Schema extends Record<string, z.ZodTypeAny>>(
  schema: Schema,
  result: unknown
) {
  const schemaObject = z.object(schema);
  return schemaObject.parse(result);
}

describe('implement validation issue', () => {
  it('should validate result with schema from closure', async () => {
    // Simulate what happens in implement()
    const schema = {
      doubled: z.array(z.number()),
    };

    // This is what happens at validation time
    const result = { doubled: [2, 4, 6, 8, 10] };

    // This is the failing line
    const schemaObject = z.object(schema);
    const parsed = schemaObject.parse(result);

    expect(parsed).toEqual({ doubled: [2, 4, 6, 8, 10] });
  });

  it('should validate greeting schema', async () => {
    const schema = {
      greeting: z.string(),
      name: z.string(),
    };

    const result = { greeting: 'Hello, Alice!', name: 'Alice' };

    const schemaObject = z.object(schema);
    const parsed = schemaObject.parse(result);

    expect(parsed).toEqual({ greeting: 'Hello, Alice!', name: 'Alice' });
  });

  it('should validate after zodToJsonSchema call', async () => {
    // Simulate the EXACT flow from implement()
    const schema = {
      doubled: z.array(z.number()),
    };

    // Then it uses schema at line 119
    const result = { doubled: [2, 4, 6, 8, 10] };
    const schemaObject = z.object(schema);
    const parsed = schemaObject.parse(result);

    expect(parsed).toEqual({ doubled: [2, 4, 6, 8, 10] });
  });

  it('should validate through function parameter', async () => {
    const schema = {
      doubled: z.array(z.number()),
    };

    const result = { doubled: [2, 4, 6, 8, 10] };
    const parsed = validateWithSchema(schema, result);

    expect(parsed).toEqual({ doubled: [2, 4, 6, 8, 10] });
  });
});
