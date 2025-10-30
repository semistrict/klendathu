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
- **AI Implementation**: Generate structured data using Pydantic models
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

### `implement(prompt, context, model, **options)`

Implements functionality using Claude AI with structured output validated by a Pydantic model.

**Parameters:**
- `prompt` (str): Description of what to implement
- `context` (dict): Context variables to make available
- `model` (Type[BaseModel]): Pydantic model class for the expected result schema
- `extra_instructions` (str, optional): Additional instructions for Claude
- `cli_path` (str, optional): Path to the CLI executable
- `port` (int, optional): Port for MCP server (0 for random)
- `host` (str, optional): Host for MCP server

**Returns:**
- `Task`: Awaitable task that resolves to the validated result matching the Pydantic model schema

**Example:**
```python
from klendathu import implement
from pydantic import BaseModel

class UserProfile(BaseModel):
    name: str
    age: int
    email: str

result = implement(
    prompt="Create a user profile for a software engineer",
    context={},
    model=UserProfile
)

user = await result
print(user)  # {'name': 'Alice', 'age': 30, 'email': 'alice@example.com'}
```

## Requirements

- Python 3.10+
- Node.js (for klendathu-cli)
- ANTHROPIC_API_KEY environment variable

## Environment Variables

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Get your API key from the [Anthropic Console](https://console.anthropic.com/).

## License

MIT
