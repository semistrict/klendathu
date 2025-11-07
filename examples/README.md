# Examples

## Running Examples

```bash
# From monorepo root
pnpm build

# Run basic implementation example
pnpm --filter @klendathu/klendathu test examples/basic-implementation.ts
```

## Basic Implementation Example

The `basic-implementation.ts` example shows how to use `implement()` to generate code:

1. Define a schema (what the output should look like)
2. Provide an instruction (what you want implemented)
3. Add context variables (data the implementation can use)
4. Claude generates code and returns the validated result

```typescript
const result = await implement({
  instruction: 'Create a greeting message for the person with the given name',
  schema: z.object({
    greeting: z.string(),
    name: z.string(),
  }),
  context: { personName: 'Alice' },
});

// Result: { greeting: "Hello, Alice! Welcome!", name: "Alice" }
```

## How It Works

1. Define a Zod schema that describes the output shape
2. Call `implement()` with:
   - `instruction`: What you want generated
   - `schema`: The expected output format
   - `context`: Variables available during implementation
3. Claude's agent uses two MCP tools:
   - `eval`: Execute code to explore and compute values
   - `set_result`: Return the final result
4. Result is validated against the schema before returning

## Caching

Subsequent calls with the same instruction + schema use cached transcripts, avoiding API calls entirely.
