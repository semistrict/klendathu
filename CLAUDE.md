# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**klendathu** is a runtime debugger that uses AI and the Model Context Protocol (MCP) to investigate errors in Node.js applications. When an error occurs, it spawns an MCP server that provides an `eval` tool for inspecting error context, then launches a CLI that connects an AI provider to investigate.

Built with the [Vercel AI SDK](https://sdk.vercel.ai) and supports all major AI providers.

Named after the bug planet from Starship Troopers.

## Commands

```bash
# Build all packages (monorepo)
pnpm build

# Run all tests
pnpm test

# Run a single test file
cd packages/klendathu && pnpm test src/launcher.test.ts
cd packages/e2e-test && pnpm test src/debugger.test.ts

# Watch mode for development
pnpm dev

# Clean all build outputs
pnpm clean
```

## Architecture

The system has three main components that work together:

### 1. Library (`packages/klendathu`)

The main library that users import. Key files:

- **`launcher.ts`**: The `investigate()` function that orchestrates everything:
  - Accepts a context object with error and variables
  - Starts an HTTP MCP server with the debug context
  - Spawns the CLI as a child process
  - Pipes a dynamically generated prompt to the CLI via stdin
  - Returns a Promise that resolves to Claude's investigation text
  - Provides `stderr` async iterator for structured progress messages
  - Provides `summary` Promise for cost/turn statistics

- **`server.ts`**: Creates the MCP debug server:
  - Provides a single `eval` tool that executes JS in a VM context
  - The VM has access to `context` (all user-provided variables) and Node.js globals
  - Captures `console.log()` output and returns it with the eval result
  - Runs on a random HTTP port by default

- **`types.ts`**: Core interfaces
  - `DebugContext`: The context object sent to the MCP server
  - `DebuggerPromise`: Special Promise with `stderr` and `summary` properties
  - `StderrMessage`: Zod schema for structured stderr (all stderr is JSON)

### 2. CLI (`packages/klendathu-cli`)

A single-file bundled executable (via Vite):

- **`cli.ts`**:
  - Reads MCP server URL from command line args
  - Reads investigation prompt from stdin
  - Connects to the MCP server using AI SDK 6 (`experimental_createMCPClient`)
  - Uses `Experimental_Agent` with configurable provider (defaults to Claude Code)
  - Emits structured JSON to stderr for progress tracking
  - Outputs final investigation result to stdout
  - Note: Claude Code provider uses built-in tools (Read, Grep, Bash) which bypass MCP tool tracking

- **`config.ts`**: Configuration loader
  - Reads from `.klendathu.json` (global: `~/.klendathu.json`, local: `./.klendathu.json`)
  - Environment variable overrides: `KLENDATHU_PROVIDER`, `KLENDATHU_MODEL`
  - Schema: `{ provider: string, model?: string, options?: Record<string, unknown> }`
  - Priority: env vars > local config > global config > defaults
  - Default provider: `claude-code`

- **`providers.ts`**: Provider factory
  - Maps config to AI SDK 6 provider instances using `createAnthropic()`, `createOpenAI()`, etc.
  - Supported providers: anthropic, openai, azure, google, google-vertex, mistral, groq, amazon-bedrock, cohere, xai, claude-code
  - Each provider uses factory functions that accept options (apiKey, baseURL, headers, etc.)
  - API keys loaded from environment: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.

### 3. E2E Tests (`packages/e2e-test`)

- **`debugger.test.ts`**: Full integration test that:
  - Creates a real error (accessing undefined property)
  - Calls `investigate()` with error context
  - Spawns the actual server and CLI
  - Verifies the AI produces a useful investigation
  - Uses Claude Code provider by default (requires `claude login`)
  - Can test other providers via `test:openai`, `test:anthropic`, etc.

## Key Design Patterns

### ContextItem and ContextCallable

Users can wrap context variables in `ContextItem` to provide descriptions:

```typescript
investigate({
  error,
  userId: new ContextItem(userId, 'The authenticated user ID'),
  getData: new ContextCallable(getData, 'Function to fetch user data')
});
```

### Structured Stderr Protocol

All stderr output is JSON with a `type` discriminator:
- `server_started`: MCP server URL
- `log`: General messages
- `turn`: Claude turn completed
- `tool_call`: Claude called an MCP tool
- `tool_result`: MCP tool execution result
- `summary`: Final statistics (turns, tokens, finishReason, toolCallsCount, warnings)

The launcher parses these and makes them available via the `stderr` async iterator.

**Note on tool tracking:** The Claude Code provider uses its own built-in tools (Read, Grep, Bash, etc.) which don't appear as MCP tool calls in `result.steps`. Only calls to the MCP `eval` tool are tracked. Other providers (anthropic, openai, etc.) will show accurate MCP tool call tracking.

### Dynamic Prompt Generation

The launcher generates a prompt that includes:
- Error stack trace (if available)
- List of available context variables with descriptions
- Instructions for using the MCP eval tool
- User's `extraInstructions` if provided

This prompt is sent to the AI agent via the CLI.

### CLI Path Resolution

In development (monorepo), the launcher finds the CLI at:
`packages/klendathu-cli/dist/cli.js`

This is resolved relative to the launcher's import.meta.url.

## Build Process

- **klendathu**: TypeScript compiled with `tsc` (preserves .js extensions in imports)
- **klendathu-cli**: Uses Vite for bundling with TypeScript type-checking before build
  - Type-checking runs via `pnpm typecheck` (tsc --noEmit)
  - Vite bundles src/cli.ts into dist/cli.js with shebang using SSR mode
  - All Node.js built-in modules are externalized (via `builtinModules`)
  - All AI SDK providers are installed as dependencies but externalized at build time
  - Bundled external dependencies: `ai`, `@ai-sdk/mcp`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, etc.
  - chmod +x is applied via build script
- **Root pnpm test**: Runs `pnpm build` before tests to ensure everything is up-to-date

## Configuration

Users can configure which AI provider and model to use:

**Config file** (`.klendathu.json`):
```json
{
  "provider": "anthropic",
  "model": "MODEL_NAME_HERE",
  "options": {
    "apiKey": "optional-if-env-var-set"
  }
}
```

**Environment variables** (override config file):
```bash
export KLENDATHU_PROVIDER=anthropic
export KLENDATHU_MODEL=MODEL_NAME_HERE
export ANTHROPIC_API_KEY=sk-...
```

**Supported providers** (all require explicit model specification except claude-code):
- `anthropic` (env: `ANTHROPIC_API_KEY`)
- `openai` (env: `OPENAI_API_KEY`)
- `azure` (env: `AZURE_API_KEY`)
- `google` (env: `GOOGLE_GENERATIVE_AI_API_KEY`)
- `google-vertex` (env: Google Cloud credentials)
- `mistral` (env: `MISTRAL_API_KEY`)
- `groq` (env: `GROQ_API_KEY`)
- `amazon-bedrock` (env: AWS credentials)
- `cohere` (env: `COHERE_API_KEY`)
- `xai` (env: `XAI_API_KEY`)
- `claude-code` (auth: `claude login`, models: sonnet [default], opus)

**Note:** Model names must be explicitly specified (except for claude-code which defaults to 'sonnet'). Refer to each provider's documentation for available models.

## Testing Philosophy

- Unit tests in `packages/klendathu` for launcher and server logic
- E2E tests can use any AI provider via `test:openai`, `test:anthropic`, `test:google`, `test:bedrock`
- Default `pnpm test` uses Claude Code provider (requires `claude login`)
- Other providers require API keys and explicit model names in environment variables
- Tests use explicit assertions, not vague ones (see user's CLAUDE.md rules)
- Summary metrics verified: turns, tokens (input/output/total), finishReason, toolCallsCount, warnings
- Tests cost money and are slow (~20-40s) as they use real AI APIs

## Future: Multi-Language Support

The architecture is designed to support Python, Go, etc.:
1. Each language implements its own MCP server with an `eval` tool
2. The language-specific library launches the same `klendathu-cli`
3. The CLI is language-agnostic (just connects to MCP and talks to Claude)
