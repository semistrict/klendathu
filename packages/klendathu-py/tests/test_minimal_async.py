"""Minimal async test to debug pytest-asyncio"""

import pytest
import asyncio
from pydantic import BaseModel

class TestModel(BaseModel):
    value: str

@pytest.mark.asyncio
async def test_minimal_async():
    """Minimal async test"""
    print("[MINIMAL] Starting minimal async test")
    from klendathu import implement
    print("[MINIMAL] Imported klendathu")

    print("[MINIMAL] About to call implement")
    result = await implement(
        "Return a simple object with value='test'",
        {},
        TestModel
    )
    print(f"[MINIMAL] Got result: {result}")

    assert result.value == "test"
