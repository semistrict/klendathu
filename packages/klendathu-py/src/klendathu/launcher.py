"""Main launcher for klendathu Python debugger"""

import asyncio
import json
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Optional, Union, AsyncIterator, Type
from types import TracebackType

from .server import create_mcp_server
from .types import StatusMessage, Summary, StackFrame, ContextItemType, DebugContext, ImplementContext


class ContextItem:
    """Wrapper for context variables with descriptions"""

    def __init__(self, value: Any, description: Optional[str] = None):
        self.value = value
        self.description = description


class ContextCallable(ContextItem):
    """Wrapper for callable context items"""

    def __init__(self, func: Any, description: Optional[str] = None):
        super().__init__(func, description)
        self.func = func


class _DebuggerPromise:
    """Promise-like object that provides investigation result and status streams"""

    def __init__(self):
        self._result: Optional[str] = None
        self._error: Optional[Exception] = None
        self._done = False
        self._stderr_messages: list[StatusMessage] = []
        self._summary: Optional[Summary] = None

    def _set_result(self, result: str) -> None:
        """Set the investigation result"""
        self._result = result
        self._done = True

    def _set_error(self, error: Exception) -> None:
        """Set an error"""
        self._error = error
        self._done = True

    def _add_stderr_message(self, message: StatusMessage) -> None:
        """Add a stderr message"""
        self._stderr_messages.append(message)
        if message.get("type") == "summary":
            self._summary = message  # type: ignore

    def __await__(self):
        """Make this awaitable"""

        async def _wait():
            while not self._done:
                await asyncio.sleep(0.01)
            if self._error:
                raise self._error
            return self._result

        return _wait().__await__()

    @property
    async def stderr(self) -> AsyncIterator[StatusMessage]:
        """Stream of structured status messages"""
        index = 0
        while True:
            if index < len(self._stderr_messages):
                yield self._stderr_messages[index]
                index += 1
            elif self._done:
                break
            else:
                await asyncio.sleep(0.01)

    @property
    async def summary(self) -> Summary:
        """Get the summary statistics"""
        while not self._summary and not self._done:
            await asyncio.sleep(0.01)
        if self._summary:
            return self._summary
        raise RuntimeError("No summary available")


def extract_call_stack(
    error: Optional[BaseException] = None, skip_frames: int = 2
) -> list[StackFrame]:
    """
    Extracts call stack from an exception or current execution point

    Args:
        error: Optional exception to extract stack from
        skip_frames: Number of frames to skip (default 2)

    Returns:
        List of stack frames
    """
    frames: list[StackFrame] = []

    if error and hasattr(error, "__traceback__"):
        tb = error.__traceback__
        while tb:
            frame = tb.tb_frame
            code = frame.f_code
            # Skip internal frames
            if "site-packages" not in code.co_filename and "<" not in code.co_filename:
                frames.append(
                    {
                        "filePath": code.co_filename,
                        "line": tb.tb_lineno,
                        "column": 0,
                        "functionName": code.co_name,
                    }
                )
            tb = tb.tb_next
    else:
        # Get current stack
        stack = traceback.extract_stack()
        for i, frame_summary in enumerate(stack):
            if i < skip_frames:
                continue
            if "site-packages" not in frame_summary.filename and "<" not in frame_summary.filename:
                frames.append(
                    {
                        "filePath": frame_summary.filename,
                        "line": frame_summary.lineno,
                        "column": 0,
                        "functionName": frame_summary.name,
                    }
                )

    return frames


def build_context(context: dict[str, Union[Any, ContextItem]]) -> tuple[
    dict[str, Any], list[ContextItemType]
]:
    """
    Builds context variables and metadata from input

    Args:
        context: Dictionary of context variables (may include ContextItem wrappers)

    Returns:
        Tuple of (context_vars, context_items)
    """
    context_vars: dict[str, Any] = {}
    context_items: list[ContextItemType] = []

    for key, value in context.items():
        if isinstance(value, ContextItem):
            context_vars[key] = value.value

            # Special handling for exceptions
            if isinstance(value.value, BaseException):
                error = value.value
                type_name = type(error).__name__
                description = value.description or ""
                if description:
                    description += "\n"
                description += f"Message: {str(error)}\n"
                if hasattr(error, "__traceback__"):
                    description += f"Traceback:\n{''.join(traceback.format_tb(error.__traceback__))}"

                context_items.append({"name": key, "type": type_name, "description": description})
            else:
                context_items.append(
                    {
                        "name": key,
                        "type": type(value.value).__name__,
                        "description": value.description,
                    }
                )
        else:
            context_vars[key] = value

            # Special handling for exceptions
            if isinstance(value, BaseException):
                type_name = type(value).__name__
                description = f"Message: {str(value)}\n"
                if hasattr(value, "__traceback__"):
                    description += (
                        f"Traceback:\n{''.join(traceback.format_tb(value.__traceback__))}"
                    )

                context_items.append({"name": key, "type": type_name, "description": description})
            else:
                context_items.append({"name": key, "type": type(value).__name__})

    return context_vars, context_items


def find_cli_path() -> str:
    """
    Finds the klendathu-cli executable

    Returns:
        Path to the CLI
    """
    # In development (monorepo), look for the sibling package
    current_file = Path(__file__).resolve()
    cli_path = current_file.parent.parent.parent.parent / "klendathu-cli" / "dist" / "cli.js"

    if cli_path.exists():
        return str(cli_path)

    # Try installed package (future)
    # This would look in site-packages or similar
    raise RuntimeError("Could not find klendathu-cli. Make sure it is built (pnpm build)")


async def run_agent(
    mode: str,
    mcp_url: str,
    call_stack: list[StackFrame],
    context: list[ContextItemType],
    timestamp: str,
    pid: int,
    extra_instructions: Optional[str] = None,
    cli_path: Optional[str] = None,
    prompt: Optional[str] = None,
    schema: Optional[dict[str, Any]] = None,
) -> tuple[int, str, list[StatusMessage]]:
    """
    Runs the agent CLI with structured input

    Returns:
        Tuple of (exit_code, stdout, stderr_messages)
    """
    resolved_cli_path = cli_path or find_cli_path()

    # Build structured input
    input_data = {
        "mode": mode,
        "mcpUrl": mcp_url,
        "callStack": call_stack,
        "context": context,
        "timestamp": timestamp,
        "pid": pid,
    }

    if extra_instructions:
        input_data["extraInstructions"] = extra_instructions

    # Add implement-specific fields
    if mode == "implement":
        if prompt:
            input_data["prompt"] = prompt
        if schema:
            input_data["schema"] = schema

    stdin_data = json.dumps(input_data)

    # Spawn the CLI with Node.js
    process = await asyncio.create_subprocess_exec(
        "node",
        resolved_cli_path,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    # Send input to stdin
    if process.stdin:
        process.stdin.write(stdin_data.encode())
        process.stdin.close()

    # Read stdout and stderr
    stdout_task = asyncio.create_task(process.stdout.read() if process.stdout else asyncio.sleep(0))
    stderr_task = asyncio.create_task(process.stderr.read() if process.stderr else asyncio.sleep(0))

    stdout_bytes, stderr_bytes = await asyncio.gather(stdout_task, stderr_task)

    # Wait for process to finish
    await process.wait()

    stdout = stdout_bytes.decode() if isinstance(stdout_bytes, bytes) else ""
    stderr = stderr_bytes.decode() if isinstance(stderr_bytes, bytes) else ""

    # Parse stderr messages
    stderr_messages: list[StatusMessage] = []
    for line in stderr.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
            stderr_messages.append(message)  # type: ignore
        except json.JSONDecodeError:
            # Skip malformed lines
            pass

    return process.returncode or 0, stdout, stderr_messages


def investigate(
    context: dict[str, Union[Any, ContextItem]],
    extra_instructions: Optional[str] = None,
    cli_path: Optional[str] = None,
    port: int = 0,
    host: str = "localhost",
) -> _DebuggerPromise:
    """
    Investigates an error using Claude AI

    Args:
        context: Context variables to make available (error, variables, etc.)
        extra_instructions: Optional additional instructions for Claude
        cli_path: Optional path to the CLI executable
        port: Port for MCP server (0 for random)
        host: Host for MCP server

    Returns:
        DebuggerPromise that resolves with Claude's analysis

    Example:
        ```python
        try:
            user = get_user(user_id)
            result = process_data(user)
        except Exception as error:
            result = investigate({
                'error': error,
                'user_id': ContextItem(user_id, 'The authenticated user ID')
            })
            print(await result)
        ```
    """
    promise = _DebuggerPromise()

    async def _run():
        try:
            # Build context
            context_vars, context_items = build_context(context)

            # Extract call stack
            error = context_vars.get("error")
            error_obj = error if isinstance(error, BaseException) else None
            call_stack = extract_call_stack(error_obj, 2)

            timestamp = datetime.utcnow().isoformat() + "Z"
            pid = os.getpid()

            debug_context: DebugContext = {
                "context": context_vars,
                "contextDescriptions": {},
                "timestamp": timestamp,
                "pid": pid,
            }

            # Start MCP server
            mcp_server = await create_mcp_server(debug_context, port, host)

            # Emit server started event
            server_started_msg: StatusMessage = {
                "type": "server_started",
                "url": mcp_server.url,
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
            promise._add_stderr_message(server_started_msg)

            # Run the agent
            exit_code, stdout, stderr_messages = await run_agent(
                mode="investigate",
                mcp_url=mcp_server.url,
                call_stack=call_stack,
                context=context_items,
                timestamp=timestamp,
                pid=pid,
                extra_instructions=extra_instructions,
                cli_path=cli_path,
            )

            # Add all stderr messages to promise
            for msg in stderr_messages:
                promise._add_stderr_message(msg)

            # Close server
            await mcp_server.close()

            if exit_code != 0:
                raise RuntimeError(f"Debugger exited with code {exit_code}")

            promise._set_result(stdout)

        except Exception as e:
            promise._set_error(e)

    # Start the task
    asyncio.create_task(_run())

    return promise


def implement(
    prompt: str,
    context: dict[str, Union[Any, ContextItem]],
    model: Type[Any],
    extra_instructions: Optional[str] = None,
    cli_path: Optional[str] = None,
    port: int = 0,
    host: str = "localhost",
) -> Any:
    """
    Implements functionality using Claude AI with structured output

    Args:
        prompt: Description of what to implement
        context: Context variables to make available
        model: Pydantic model class for the expected result schema
        extra_instructions: Optional additional instructions for Claude
        cli_path: Optional path to the CLI executable
        port: Port for MCP server (0 for random)
        host: Host for MCP server

    Returns:
        Promise that resolves with the validated result matching the schema

    Example:
        ```python
        from pydantic import BaseModel

        class UserResult(BaseModel):
            name: str
            age: int
            email: str

        result = implement(
            "Create a user object with sample data",
            {},
            UserResult
        )
        user = await result
        print(user)  # {'name': 'Alice', 'age': 30, 'email': 'alice@example.com'}
        ```
    """

    async def _run() -> Any:
        # Build context
        context_vars, context_items = build_context(context)

        # Extract call stack
        call_stack = extract_call_stack(None, 2)

        timestamp = datetime.utcnow().isoformat() + "Z"
        pid = os.getpid()

        implement_context: ImplementContext = {
            "context": context_vars,
            "contextDescriptions": {},
            "timestamp": timestamp,
            "pid": pid,
            "model": model,
        }

        # Start MCP server with model
        mcp_server = await create_mcp_server(implement_context, port, host)

        # Serialize model schema to JSON (simplified)
        schema_json = {}
        if hasattr(model, "model_json_schema"):
            schema_json = model.model_json_schema()

        # Run the agent
        exit_code, stdout, stderr_messages = await run_agent(
            mode="implement",
            mcp_url=mcp_server.url,
            call_stack=call_stack,
            context=context_items,
            timestamp=timestamp,
            pid=pid,
            extra_instructions=extra_instructions,
            cli_path=cli_path,
            prompt=prompt,
            schema=schema_json,
        )

        # Close server
        await mcp_server.close()

        if exit_code != 0:
            raise RuntimeError(f"Implementation failed with exit code {exit_code}")

        # Get the result from the server
        try:
            result = mcp_server.get_result()
            return result
        except Exception as error:
            raise RuntimeError(
                f"Agent did not call set_result tool. {str(error)}"
            )

    return asyncio.create_task(_run())
