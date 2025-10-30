"""Tests for launcher module"""

import pytest
from klendathu.launcher import (
    extract_call_stack,
    build_context,
    ContextItem,
    ContextCallable,
    find_cli_path,
)


def test_extract_call_stack_from_exception():
    """Test extracting call stack from an exception"""
    try:
        def inner():
            raise ValueError("test error")

        def outer():
            inner()

        outer()
    except Exception as e:
        stack = extract_call_stack(e, skip_frames=0)
        assert len(stack) > 0
        # Check that 'inner' appears in one of the frames
        function_names = [frame.get("functionName", "") for frame in stack]
        assert "inner" in function_names


def test_extract_call_stack_current():
    """Test extracting current call stack"""
    stack = extract_call_stack(skip_frames=0)
    assert len(stack) > 0
    # Should have this test function in the stack
    assert any("test_extract_call_stack_current" in str(frame.get("functionName", "")) for frame in stack)


def test_build_context_simple():
    """Test building context from simple variables"""
    context_vars, context_items = build_context({"x": 42, "y": "hello"})

    assert context_vars == {"x": 42, "y": "hello"}
    assert len(context_items) == 2
    assert context_items[0]["name"] == "x"
    assert context_items[0]["type"] == "int"
    assert context_items[1]["name"] == "y"
    assert context_items[1]["type"] == "str"


def test_build_context_with_context_item():
    """Test building context with ContextItem wrappers"""
    context_vars, context_items = build_context(
        {"x": ContextItem(42, "The answer"), "y": "hello"}
    )

    assert context_vars == {"x": 42, "y": "hello"}
    assert len(context_items) == 2
    assert context_items[0]["name"] == "x"
    assert context_items[0]["type"] == "int"
    assert context_items[0]["description"] == "The answer"


def test_build_context_with_exception():
    """Test building context with exception"""
    error = ValueError("test error")
    context_vars, context_items = build_context({"error": error})

    assert context_vars["error"] == error
    assert len(context_items) == 1
    assert context_items[0]["name"] == "error"
    assert context_items[0]["type"] == "ValueError"
    assert "Message: test error" in context_items[0]["description"]


def test_context_callable():
    """Test ContextCallable wrapper"""
    def my_func(x):
        return x * 2

    item = ContextCallable(my_func, "Doubles the input")
    assert item.value == my_func
    assert item.func == my_func
    assert item.description == "Doubles the input"


def test_find_cli_path():
    """Test finding the CLI path"""
    cli_path = find_cli_path()
    assert "klendathu-cli" in cli_path
    assert cli_path.endswith("cli.js")


def test_implement_import():
    """Test that implement function can be imported"""
    from klendathu.launcher import implement
    assert implement is not None
    assert callable(implement)
