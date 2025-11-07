# klendathu

AI-powered code implementation library using Claude and the Model Context Protocol (MCP).

## Overview

`klendathu` generates code based on natural language prompts and JSON schemas. Given a prompt (what to build) and a schema (expected output shape), it spawns Claude via the Agent SDK to implement the functionality and returns a validated result.

Uses [Claude Agent SDK](https://sdk.vercel.ai), [Model Context Protocol](https://modelcontextprotocol.io/), and [Zod](https://zod.dev/) for schema validation.

Named after the bug planet from Starship Troopers.

## Structure

- **src/** - Library and CLI source code
- **test/** - Integration tests
- **examples/** - Usage examples
- **dist/** - Compiled output (library and CLI)

## Installation

```bash
pnpm install
pnpm build
```

## Usage

### Basic Example

```typescript
import { implement } from 'klendathu';
import { z } from 'zod';

// Define what you want
const greetingSchema = {
  greeting: z.string(),
  name: z.string(),
};

// Implement it with AI
const result = await implement(
  'Create a greeting message for Alice',
  { personName: 'Alice' },
  greetingSchema
);

// result is typed: { greeting: string; name: string }
console.log(result.greeting); // "Hello, Alice! Welcome!"
```

### Best Practice: Add Descriptions

Use `.describe()` on schema fields to guide Claude towards correct output formatting:

```typescript
import { implement } from 'klendathu';
import { z } from 'zod';

// Define schema with descriptions for each field
const orderSchema = {
  orderId: z.string().describe('Order ID as a string'),
  total: z.string().describe('Total amount as a decimal number string (e.g., "99.99"), without currency symbol or dollar sign'),
  itemCount: z.number().describe('Number of items in the order'),
  items: z.array(z.string()).describe('List of item names'),
};

// Implement with AI
const result = await implement(
  'Extract the order details from the provided HTML',
  { pageHTML: '<div>...</div>' },
  orderSchema
);

console.log(result.total); // "99.99" (no dollar sign)
```

The descriptions are sent to Claude, helping it understand exactly what format you expect for each field.

## How It Works

1. **Library** starts an HTTP server on Unix Domain Socket
2. **Library** spawns CLI subprocess, passes socket path
3. **CLI** fetches task details (prompt, schema, context) from server
4. **CLI** checks cache (skip agent if seen before)
5. **CLI** creates in-process MCP server with `eval` and `set_result` tools
6. **CLI** invokes Claude Agent SDK with the Mustache-rendered prompt
7. **Claude** uses the tools to write and execute code
8. **CLI** returns validated result to stdout
9. **Library** validates result against schema, returns to user

## Caching

Implementations are cached by instruction + schema. Subsequent calls with the same prompt skip the agent and replay the cached transcript directly, saving time and API costs.

Cache location: `.klendathu/cache/` (or `$KLENDATHU_CACHE`)

## Authentication

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Get your API key from the [Anthropic Console](https://console.anthropic.com/).

## Testing

```bash
# Run unit tests only (fast)
pnpm test

# Run E2E tests only (slow, requires API key)
pnpm test:e2e

# Run all tests including E2E (slow, requires API key)
pnpm test:all

# Run single E2E test
pnpm test:e2e test/implement-simple.test.ts
```

## Debugging

Enable trace logging to see what's happening:

```bash
KLENDATHU_TRACE=1 pnpm test
# Logs are written to ~/.klendathu/trace.log
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Watch mode
pnpm dev

# Run linter
pnpm lint
```

See [CLAUDE.md](./CLAUDE.md) for detailed architecture and implementation notes.
