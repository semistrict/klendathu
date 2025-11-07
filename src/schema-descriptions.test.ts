import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

describe('schema descriptions serialization', () => {
  it('should preserve field descriptions in JSON schema', () => {
    // Create a schema with descriptions (like the CLI will receive)
    const schema = {
      userName: z.string(),
      userEmail: z.string(),
      orderCount: z.number(),
      firstOrderId: z.string(),
      firstOrderTotal: z.string().describe('The total amount as a decimal number string (e.g. "234.99"), without currency symbol or dollar sign'),
      firstOrderItemCount: z.number(),
    };

    // Convert to JSON schema (same as implement.ts does)
    const jsonSchema = zodToJsonSchema(z.object(schema)) as any;

    // Verify the description is in the serialized JSON schema
    expect(jsonSchema).toHaveProperty('properties.firstOrderTotal.description');
    expect(jsonSchema.properties.firstOrderTotal.description).toBe(
      'The total amount as a decimal number string (e.g. "234.99"), without currency symbol or dollar sign'
    );
  });

  it('should serialize multiple descriptions in same schema', () => {
    const schema = {
      amount: z.string().describe('Amount in decimal format without currency symbol'),
      itemCount: z.number().describe('Total number of items'),
      isActive: z.boolean().describe('Whether the order is active'),
    };

    const jsonSchema = zodToJsonSchema(z.object(schema)) as any;

    // Check all descriptions are preserved
    expect(jsonSchema.properties.amount.description).toBe('Amount in decimal format without currency symbol');
    expect(jsonSchema.properties.itemCount.description).toBe('Total number of items');
    expect(jsonSchema.properties.isActive.description).toBe('Whether the order is active');
  });

  it('should preserve descriptions through the full implement flow structure', () => {
    // Simulate the exact schema structure from implement()
    const schema = {
      name: z.string(),
      price: z.string().describe('Price without currency symbol, e.g., "99.99"'),
      quantity: z.number(),
    };

    const jsonSchema = zodToJsonSchema(z.object(schema)) as any;
    const properties = jsonSchema.properties as Record<string, any>;

    // This proves descriptions are serialized and will be sent to CLI
    expect(properties.price.description).toBe('Price without currency symbol, e.g., "99.99"');
    expect(properties.name.description).toBeUndefined(); // No description set
    expect(properties.quantity.description).toBeUndefined(); // No description set
  });
});
