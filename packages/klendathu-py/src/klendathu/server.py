"""MCP server for Python debugging"""

import asyncio
import json
import sys
from io import StringIO
from typing import Any, Callable
from contextlib import redirect_stdout, redirect_stderr

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent
from pydantic import BaseModel, Field


class EvalInput(BaseModel):
    """Input for eval tool"""

    function: str = Field(
        description='Function expression to evaluate, e.g., "lambda: print(context[\'someVar\'])"'
    )


class McpServerInstance:
    """MCP server instance"""

    def __init__(
        self,
        url: str,
        port: int,
        close_fn: Callable[[], None],
        get_result_fn: Callable[[], Any] | None = None,
    ):
        self.url = url
        self.port = port
        self._close_fn = close_fn
        self._get_result_fn = get_result_fn

    async def close(self) -> None:
        """Close the server"""
        self._close_fn()

    def get_result(self) -> Any:
        """Get the result (for implement mode)"""
        if self._get_result_fn is None:
            raise RuntimeError("get_result not available (not in implement mode)")
        return self._get_result_fn()


async def create_mcp_server(
    context: dict[str, Any], port: int = 0, host: str = "localhost"
) -> McpServerInstance:
    """
    Creates and starts an HTTP MCP server with debugging tools

    Args:
        context: Debug context with variables to expose
        port: Port to run on (0 for random)
        host: Host to bind to

    Returns:
        McpServerInstance with url, port, and close method
    """
    from aiohttp import web

    server = Server("klendathu")
    debug_context = context.get("context", {})
    pydantic_model = context.get("model")  # For implement mode

    # Shared state for set_result tool
    result_value: Any = None
    result_was_set = False
    implementation_failed = False
    failure_reason = ""

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        """List available tools"""
        tools = [
            Tool(
                name="eval",
                description=(
                    "Evaluates a Python function expression with access to the debugging context. "
                    "The function can be async and has access to: context (dict with all context variables). "
                    "Stdout/stderr output is captured and returned. "
                    "Use this to inspect variables or execute any debugging logic."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "function": {
                            "type": "string",
                            "description": 'Function expression to evaluate, e.g., "lambda: print(context[\'someVar\'])"',
                        }
                    },
                    "required": ["function"],
                },
            )
        ]

        # Add set_result tool if in implement mode
        if pydantic_model is not None:
            tools.append(
                Tool(
                    name="set_result",
                    description=(
                        "Sets the final result of the implementation by evaluating a function. "
                        "This tool MUST be called with your completed implementation before finishing. "
                        "The function should accept the context dict as a parameter and return the implementation result. "
                        "The returned value will be validated against the expected Pydantic model schema."
                    ),
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "function": {
                                "type": "string",
                                "description": 'Function expression that takes context as parameter and returns the result, e.g., "lambda context: {\'result\': \'value\'}"',
                            }
                        },
                        "required": ["function"],
                    },
                )
            )
            tools.append(
                Tool(
                    name="fail_implementation",
                    description=(
                        "Call this tool if you cannot fulfill the implementation request. "
                        "Provide a clear reason explaining why the implementation cannot be completed. "
                        "This will raise an exception with your reason, allowing the caller to handle the failure gracefully."
                    ),
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "reason": {
                                "type": "string",
                                "description": "Clear explanation of why the implementation cannot be completed",
                            }
                        },
                        "required": ["reason"],
                    },
                )
            )

        return tools

    @server.call_tool()
    async def call_tool(name: str, arguments: Any) -> list[TextContent]:
        """Handle tool calls"""
        nonlocal result_value, result_was_set, implementation_failed, failure_reason

        if name == "fail_implementation":
            # Handle failure reporting for implement mode
            if pydantic_model is None:
                return [TextContent(type="text", text="Error: fail_implementation tool not available (not in implement mode)")]

            reason = arguments.get("reason", "No reason provided")
            implementation_failed = True
            failure_reason = reason

            return [TextContent(type="text", text=f"Implementation failure recorded: {reason}")]

        elif name == "set_result":
            # Handle set_result tool for implement mode
            if pydantic_model is None:
                return [TextContent(type="text", text="Error: set_result tool not available (not in implement mode)")]

            fn_code = arguments.get("function", "")
            try:
                # Create execution namespace with context
                namespace = {
                    "context": debug_context,
                    "__builtins__": __builtins__,
                }

                # Execute the function
                fn = eval(fn_code, namespace)
                if asyncio.iscoroutinefunction(fn):
                    result = await fn(debug_context)
                else:
                    result = fn(debug_context)

                # Validate result against Pydantic model
                validated = pydantic_model(**result) if isinstance(result, dict) else pydantic_model(result)
                result_value = validated.model_dump()
                result_was_set = True

                return [TextContent(type="text", text="Result set successfully and validated against schema.")]

            except Exception as e:
                import traceback
                error_msg = f"Error: {str(e)}\n\n{traceback.format_exc()}\n\nPlease fix the errors and call set_result again with a valid function."
                return [TextContent(type="text", text=error_msg)]

        elif name == "eval":
            # Handle eval tool
            fn_code = arguments.get("function", "")
            try:
                # Capture stdout and stderr
                stdout_capture = StringIO()
                stderr_capture = StringIO()

                # Create execution namespace with context
                namespace = {
                    "context": debug_context,
                    "__builtins__": __builtins__,
                }

                # Execute the function
                with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                    # Compile and execute the function
                    fn = eval(fn_code, namespace)
                    if asyncio.iscoroutinefunction(fn):
                        result = await fn()
                    else:
                        result = fn()

                # Build output
                output: dict[str, Any] = {"result": result}

                captured_stdout = stdout_capture.getvalue()
                captured_stderr = stderr_capture.getvalue()

                console_logs = []
                if captured_stdout:
                    console_logs.append({"level": "log", "args": [captured_stdout]})
                if captured_stderr:
                    console_logs.append({"level": "error", "args": [captured_stderr]})

                if console_logs:
                    output["console"] = console_logs

                return [TextContent(type="text", text=json.dumps(output, indent=2, default=str))]

            except Exception as e:
                error_msg = f"Error during eval: {str(e)}"
                if hasattr(e, "__traceback__"):
                    import traceback

                    error_msg += f"\n{traceback.format_exc()}"

                return [TextContent(type="text", text=error_msg)]

        else:
            raise ValueError(f"Unknown tool: {name}")

    # Create aiohttp app
    app = web.Application()

    async def handle_mcp(request: web.Request) -> web.Response:
        """Handle MCP requests"""
        try:
            body = await request.json()

            # Use stdio transport with string buffers for request/response
            input_stream = StringIO(json.dumps(body))
            output_stream = StringIO()

            # Create a task to run the stdio server
            async with stdio_server() as (read_stream, write_stream):
                # This is a simplified version - in production you'd need
                # proper streaming transport for HTTP
                # For now, return a simple response
                return web.json_response(
                    {"jsonrpc": "2.0", "result": {"status": "ok"}, "id": body.get("id")}
                )

        except Exception as e:
            return web.json_response(
                {
                    "jsonrpc": "2.0",
                    "error": {"code": -32603, "message": f"Internal error: {str(e)}"},
                    "id": None,
                },
                status=500,
            )

    app.router.add_post("/mcp", handle_mcp)

    # Start server
    runner = web.AppRunner(app)
    await runner.setup()

    # Use port 0 for random port if not specified
    actual_port = port if port != 0 else 0
    site = web.TCPSite(runner, host, actual_port)
    await site.start()

    # Get actual port if random was requested
    if actual_port == 0:
        actual_port = site._server.sockets[0].getsockname()[1]

    url = f"http://{host}:{actual_port}/mcp"

    def close_fn():
        """Cleanup function"""
        asyncio.create_task(runner.cleanup())

    def get_result_fn() -> Any:
        """Get the result (only for implement mode)"""
        if implementation_failed:
            raise RuntimeError(f"Implementation failed: {failure_reason}")
        if not result_was_set:
            raise RuntimeError("Result was not set by agent")
        return result_value

    # Only provide get_result if in implement mode
    get_result = get_result_fn if pydantic_model is not None else None

    return McpServerInstance(url=url, port=actual_port, close_fn=close_fn, get_result_fn=get_result)
