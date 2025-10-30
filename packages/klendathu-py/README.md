# klendathu (Python)

Runtime debugger that uses AI and the Model Context Protocol (MCP) to investigate errors in Python applications.

## Installation

```bash
pip install klendathu
```

## Quick Start

```python
from klendathu import investigate, ContextItem

try:
    user = get_user(user_id)
    result = process_data(user)
except Exception as error:
    # Investigate the error with AI
    result = investigate({
        'error': error,
        'user_id': ContextItem(user_id, 'The authenticated user ID'),
        'get_data': ContextItem(get_data, 'Function to fetch user data')
    })

    print(await result)
```

## Features

- **AI-Powered Debugging**: Uses Claude AI to analyze errors and suggest fixes
- **Context-Aware**: Provides the AI with your local variables and functions
- **MCP Integration**: Uses Model Context Protocol for secure, sandboxed code execution
- **Async Support**: Built with asyncio for modern Python applications

## How It Works

1. When an error occurs, `investigate()` captures the error and context variables
2. Spawns an MCP server that provides an `eval` tool for inspecting context
3. Launches the klendathu-cli which connects Claude AI to the MCP server
4. Claude investigates the error by calling the eval tool
5. Returns an analysis with likely causes and suggested fixes

## Context Items

Wrap variables with `ContextItem` to provide descriptions:

```python
investigate({
    'error': error,
    'user_id': ContextItem(user_id, 'The authenticated user ID'),
    'cache': ContextItem(cache, 'Redis cache instance')
})
```

## API

### `investigate(context, **options)`

Investigates an error using Claude AI.

**Parameters:**
- `context` (dict): Context variables to make available (error, variables, etc.)
- `extra_instructions` (str, optional): Additional instructions for Claude
- `cli_path` (str, optional): Path to the CLI executable
- `port` (int, optional): Port for MCP server (0 for random)
- `host` (str, optional): Host for MCP server

**Returns:**
- `DebuggerPromise`: Promise-like object with:
  - `await result`: Get the investigation text
  - `result.stderr`: Async iterator of status messages
  - `await result.summary`: Get statistics (turns, cost, tokens)

## Requirements

- Python 3.9+
- Node.js (for klendathu-cli)
- ANTHROPIC_API_KEY environment variable

## Environment Variables

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Get your API key from the [Anthropic Console](https://console.anthropic.com/).

## License

MIT
