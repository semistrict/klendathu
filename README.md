# klendathu

Debug runtime errors with AI assistance.

## Overview

When an exception occurs in your Node.js application, `klendathu` spawns an interactive AI debugging session with access to your error context. The AI can inspect the error, examine variables, and help you understand what went wrong.

Uses the [Vercel AI SDK](https://sdk.vercel.ai) and supports all major AI providers (Anthropic, OpenAI, Google, etc.).

## Architecture

```
Your Application
    │
    ├─ Error occurs
    │
    └─ investigate(context)
           │
           ├─> Starts debug server with eval tool
           │   (provides access to error context)
           │
           └─> Spawns klendathu CLI
               │
               └─> AI investigates the error
```

## Packages

- **klendathu** - Library to integrate into your Node.js apps
- **klendathu-cli** - CLI that connects AI providers to investigate errors

## Installation

```bash
pnpm install
pnpm build
```

## Usage

```typescript
import { investigate } from 'klendathu';

async function processData(data) {
  const userId = data.user.id;
  const items = fetchItems(userId);
  // ... more code
}

try {
  await processData(someData);
} catch (error) {
  // Investigate with AI - provide error and local context
  await investigate({
    error,
    data: someData,
    userId
  });
}
```

The AI will have access to an `eval` tool that can execute code with:
- All context variables you passed (error, data, userId in this example)
- All Node.js globals (console, process, Buffer, etc.)

## Authentication

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Get your API key from the [Anthropic Console](https://console.anthropic.com/).

## Example Debugging Session

```typescript
// The AI can use the eval tool like this:
{
  "function": "async () => { return context.error.stack; }"
}

// Or inspect variables:
{
  "function": "async () => { return { userId: context.userId, dataKeys: Object.keys(context.data) }; }"
}

// Or execute complex debugging logic:
{
  "function": "async () => {
    const frames = context.error.stack.split('\\n').slice(1, 4);
    const userContext = context.data?.user;
    return { frames, userContext };
  }"
}
```

## Debug Server Details

The debug server provides one tool:

### `eval`

Evaluates a JavaScript function expression with access to error context.

**Parameters:**
- `function` (string) - Function expression like `"async () => { ... }"`

**Context available in function:**
- `context` - Object containing all context variables you passed
- `metadata` - Timestamp, PID, context descriptions, etc.
- Node.js globals (console, process, Buffer, etc.)

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Watch mode
pnpm dev
```

## Future: Multi-Language Support

The architecture is designed to support other languages. A Python version would:
1. Implement the same debug server with an eval tool
2. Use Python's debugging APIs to capture context
3. Launch the same klendathu CLI

This allows the debugging experience to be consistent across languages.
