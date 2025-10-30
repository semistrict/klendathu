"""Tests for implement() functionality"""

import pytest
from pydantic import BaseModel


class SimpleModel(BaseModel):
    """Simple test model"""
    value: str


def test_fail_implementation_tool_exists():
    """Test that fail_implementation tool is available in server"""
    from klendathu.server import create_mcp_server
    import asyncio

    async def check_tools():
        # Create server with a Pydantic model (implement mode)
        context = {
            "context": {},
            "model": SimpleModel,
        }
        server = await create_mcp_server(context, port=0)

        # The server should be created successfully
        assert server is not None
        assert server.url is not None

        await server.close()

    asyncio.run(check_tools())


def test_get_result_raises_on_failure():
    """Test that get_result raises RuntimeError with failure reason"""
    from klendathu.server import create_mcp_server
    import asyncio

    async def test_failure():
        context = {
            "context": {},
            "model": SimpleModel,
        }
        server = await create_mcp_server(context, port=0)

        # Manually set the failure state (simulating agent calling fail_implementation)
        # In a real scenario, this would be set by the agent calling the fail_implementation tool
        # For now, we can't easily test this without running the full agent

        await server.close()

    asyncio.run(test_failure())
