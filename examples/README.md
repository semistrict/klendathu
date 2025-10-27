# Examples

## Running Examples

```bash
# From monorepo root
pnpm build

# Run basic error example
cd examples
node --loader ts-node/esm basic-error.ts
```

## What Happens

1. The example code throws an error
2. `investigate()` starts a debug server with the error context
3. The `claudedebug` CLI is spawned and connects to the server
4. Claude investigates using the `eval` tool to:
   - Examine the error message and stack trace
   - Inspect local variables (userId)
   - Understand what went wrong
   - Suggest a fix

## Example Eval Calls Claude Might Make

```javascript
// Get the error details
{
  "function": "async () => ({ message: context.error.message, stack: context.error.stack })"
}

// Check what variables are available
{
  "function": "async () => ({ context: Object.keys(context), metadata })"
}

// Inspect the userId that was being processed
{
  "function": "async () => ({ userId: context.userId })"
}
```
