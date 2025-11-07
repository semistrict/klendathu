# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**klendathu** is an AI-powered code implementation library that uses Claude and the Model Context Protocol (MCP) to generate code based on prompts and schemas. The library spawns an MCP server that provides tools for code execution, then launches a CLI that connects Claude Agent SDK to implement functionality.

Built with [Claude Agent SDK](https://sdk.vercel.ai) and the [Model Context Protocol](https://modelcontextprotocol.io/).

Named after the bug planet from Starship Troopers.

## Commands

```bash
# Build all packages (monorepo)
pnpm build

# Run unit tests only (fast)
pnpm test

# Run all tests including E2E (slow, requires API key)
pnpm test:all

# Run a single E2E test file
pnpm --filter @klendathu/e2e-test test implement.test
pnpm --filter @klendathu/e2e-test test implement-simple.test
pnpm --filter @klendathu/e2e-test test implement-caching.test

# Watch mode for development
pnpm dev

# Clean all build outputs
pnpm clean
```

## Architecture

The system has three main components that work together:

### 1. Library (`packages/klendathu`)

The main library that users import. Key files:

- **`implement.ts`**: The `implement()` function that orchestrates code generation:
  - Accepts a prompt (what to implement) and Zod schema (expected result shape)
  - Starts Hono HTTP server on Unix Domain Socket (UDS)
  - Spawns CLI subprocess passing the UDS socket path
  - Returns a Promise that resolves to validated result matching schema

- **`agent-runner.ts`**: Process management and utilities:
  - `runAgent()`: Spawns CLI subprocess with inherited stdio
  - `extractCallStack()`: Extracts stack frames from errors
  - `buildContext()`: Processes context variables into array format with type info
  - `findCliPath()`: Resolves CLI bundle location

- **`types.ts`**: Core interfaces
  - `ImplementOptions`: Configuration options (signal, cliPath, udsPath, forceUseCache)
  - `ImplementInput`: Schema for structured task input
  - `StackFrame`: Stack frame information with file, line, column, function name

### 2. CLI (`packages/klendathu-cli`)

A bundled executable (via Vite):

- **`cli.ts`**:
  - Receives UDS socket path as command-line argument
  - Connects to Hono HTTP server via Unix Domain Socket
  - Fetches task details (prompt, schema, context) from GET /task endpoint
  - Checks for cached transcript and uses it if available (skip agent if cache hit)
  - Creates in-process MCP server that delegates tool calls to HTTP endpoints
  - Uses `@anthropic-ai/claude-agent-sdk` `query()` function with Claude Code preset
  - Permission mode: `bypassPermissions` (auto-accepts all operations)
  - Records all agent messages and tool calls to transcript
  - Outputs final result to stdout as JSON
  - Saves transcript to cache for future reuse

- **`types.ts`**: Type definitions only (no exported schemas)

- **`strings.ts`**: Mustache prompt templates
  - `IMPLEMENT_PROMPT_TEMPLATE`: Instructions for code implementation

- **`server.ts`**: In-process MCP server
  - Creates in-process MCP server using Claude Agent SDK
  - Provides `eval` tool that delegates to HTTP POST /eval endpoint
  - Provides `set_result` tool that delegates to HTTP POST /complete endpoint
  - Provides `bail` tool for graceful failure with custom error messages
  - Returns results to Claude Agent SDK for direct execution

- **`cache.ts`**: Transcript caching
  - Generates cache key from instruction slug + SHA256(instruction + schema) hash
  - Slug limited to 50 characters, lowercase alphanumeric + underscores
  - Key format: `{instruction_slug}_{sha256_hash}.json`
  - Stored in `.klendathu/cache/` relative to project root (determined by walking up for `.klendathu` or `.git`)
  - Environment variables:
    - `KLENDATHU_CACHE`: Override cache directory path (e.g., for testing)
    - `KLENDATHU_CACHE_MODE`: Control cache behavior (`force-use` to require cache, `ignore` to skip cache, default `normal`)
  - Full transcript saved (all messages and tool calls)

- **`transcript.ts`**: Transcript management
  - Records all agent messages and tool calls during execution
  - Saves transcript to cache for future reuse
  - On cache hit: replays last successful set_result without re-running agent

### 3. E2E Tests (`packages/e2e-test`)

- **`implement.test.ts`**: Full integration tests for implementation:
  - Tests AI-driven code implementation with various schemas
  - Verifies result validation against Zod schemas
  - Uses Claude Agent SDK (uses API key from environment)
  - Tests cost money and take time (~20-40s per test)

- **`implement-simple.test.ts`**: Basic implement tests
  - Quick sanity checks for simple implementations

- **`implement-caching.test.ts`**: Caching functionality tests
  - Verifies transcript caching and replay
  - Tests schema-based cache key generation

## Key Design Patterns

### HTTP/UDS Architecture

Library and CLI communicate via HTTP over Unix Domain Socket:

1. **Socket Setup**: Library starts Hono HTTP server listening on UDS socket
2. **CLI Invocation**: Library spawns CLI subprocess, passes socket path as command-line argument
3. **Socket Communication**: CLI connects to Hono server via HTTP requests
4. **Task Fetch**: CLI fetches implementation prompt and schema via `GET /task`
5. **Tool Delegation**: MCP server delegates tool calls to HTTP endpoints (`POST /eval`, `POST /complete`)
6. **Result Return**: CLI outputs result to stdout after successful implementation

### Task Context Flow

The library sends task details to the CLI HTTP server:
1. **Instruction**: What to implement (the main prompt)
2. **Schema**: Expected output shape in JSON Schema format
3. **Context**: Variables available during implementation (with types)
4. **CallStack**: Stack frames showing where implement() was called
5. **Timestamp & PID**: Execution context information

The CLI fetches these via `GET /task` and renders them into a full prompt using Mustache templates from `strings.ts`.

### Transcript Caching

When an implementation succeeds, the transcript is saved with a cache key based on:
- **Instruction text** (main requirement, stable across runs)
- **Schema** (defines expected output shape)

The cache key slug is derived from the instruction text (first 50 chars, lowercase, underscores), making cache hits deterministic. On subsequent calls with the same instruction+schema, the cached transcript is replayed without re-invoking Claude.

### Hono Server with Endpoints

The library creates an HTTP server via `@hono/node-server` with endpoints:

- **`GET /task`**: Returns implementation task details (prompt, schema, context)
- **`POST /eval`**: Executes code in a sandbox VM and returns results
- **`POST /complete`**: Handles both success (set_result) and failure (bail):
  - Without `failure` flag: Executes code to produce the final result
  - With `failure: true` flag: Logs error message and exits with failure status
- **`GET /openapi.json`**: Serves OpenAPI specification for language-agnostic client support

All communication happens over UDS (Unix Domain Socket) for local IPC efficiency.

### CLI Path Resolution

In development (monorepo), the library finds the CLI at:
`packages/klendathu-cli/dist/cli.js`

This is resolved relative to the library's import.meta.url using `findCliPath()` in `agent-runner.ts`.

## Build Process

- **klendathu**: TypeScript compiled with `tsc` (preserves .js extensions in imports)
- **klendathu-cli**: Uses Vite for bundling with TypeScript type-checking before build
  - Type-checking runs via `pnpm typecheck` (tsc --noEmit)
  - Vite bundles src/cli.ts into dist/cli.js with shebang using SSR mode
  - All Node.js built-in modules are externalized (via `builtinModules`)
  - Externalized dependencies: `@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk`
  - Other dependencies (mustache, zod) are bundled
  - chmod +x is applied via build script
- **Root pnpm test**: Runs `pnpm build` before tests to ensure everything is up-to-date

## Authentication

The CLI uses Claude Agent SDK. To use it, set your API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Get your API key from the [Anthropic Console](https://console.anthropic.com/).

If `ANTHROPIC_API_KEY` is not set, the `query()` call will use the default API key configured in your environment.

## Testing Philosophy

- E2E integration tests in `packages/e2e-test` for implementation functionality
- Tests use real Claude Agent SDK (uses API key from environment)
- Tests verify:
  - Successful implementation with correct schema validation
  - Caching and transcript replay
  - Schema enforcement (result must match Zod schema)
- Tests cost money (~$0.01-0.05 per test) and are slow (~20-40s) as they use real AI APIs
- All tests run via `pnpm test` which builds first, ensuring fresh CLI bundle

## Additional Features

- **`implement.ts`**: AI-driven code implementation
  - Accepts a prompt and Zod schema for desired output
  - Spawns CLI subprocess that connects to MCP server
  - Agent implements functionality and validates result against schema
  - Returns typed result matching the schema with automatic validation

## Debugging and Tracing

### TRACE Logging

Enable detailed tracing to debug what Claude receives and how the system works:

```bash
# Enable TRACE logging
KLENDATHU_TRACE=1 pnpm test

# View trace output (written to ~/.klendathu/trace.log)
tail ~/.klendathu/trace.log
```

### How TRACE Works

`TRACE` is a tagged template literal function defined in `packages/klendathu-utils/src/logging.ts`:

```typescript
TRACE`Message with ${variable}`
```

**Features:**
- **Enable with environment variable**: Set `KLENDATHU_TRACE=1` or `KLENDATHU_TRACE=true`
- **Template literal syntax**: Use backticks with embedded expressions
- **Each log line includes**:
  - ISO timestamp
  - Process ID
  - Source file and line number (auto-extracted from error stack trace)
  - The formatted message
- **Value handling**:
  - Error objects: logs message + full stack trace
  - Objects: serialized with JSON.stringify
  - Other types: converted to string
- **Zero overhead when disabled**: If `KLENDATHU_TRACE` is not set, function returns immediately without any logging overhead
- **File location**: Logs appended to `~/.klendathu/trace.log` (creates directory if needed)
- **Silent failures**: If file write fails, execution continues uninterrupted

### What Gets Traced

- Full rendered prompts sent to Claude (user-provided requirements + context)
- MCP server initialization and tool calls
- Cache operations (hits, misses, saves)
- Tool calls and results
- VM context execution
- CLI process communication

### Files with Tracing

- `packages/klendathu-utils/src/logging.ts` - TRACE function definition
- `packages/klendathu/src/agent-runner.ts` - Process spawning and communication
- `packages/klendathu/src/implement.ts` - Implementation execution and schema handling
- `packages/klendathu-cli/src/server.ts` - MCP server creation and tool execution
- `packages/klendathu-cli/src/cli.ts` - CLI initialization and agent query execution

## Architecture Notes

The subprocess model (library spawns CLI) enables:
- **Isolation**: Agent runs in separate process with inherited stdio
- **Clean IPC**: HTTP over Unix Domain Socket for structured communication
- **Caching**: Transcript-based caching avoids redundant Claude calls
- **Flexibility**: CLI could be reused with other agents/languages

The cache hit path:
1. CLI fetches task details from server
2. Checks for cached transcript based on instruction + schema
3. On hit: Replays last successful `set_result` code without agent
4. On miss: Runs full agent workflow, saves transcript for future use
