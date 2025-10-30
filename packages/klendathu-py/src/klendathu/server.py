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

    def __init__(self, url: str, port: int, close_fn: Callable[[], None]):
        self.url = url
        self.port = port
        self._close_fn = close_fn

    async def close(self) -> None:
        """Close the server"""
        self._close_fn()


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

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        """List available tools"""
        return [
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

    @server.call_tool()
    async def call_tool(name: str, arguments: Any) -> list[TextContent]:
        """Handle tool calls"""
        if name != "eval":
            raise ValueError(f"Unknown tool: {name}")

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

    return McpServerInstance(url=url, port=actual_port, close_fn=close_fn)
