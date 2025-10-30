"""End-to-end tests for klendathu Python implementation"""

import pytest
import asyncio
from pydantic import BaseModel


class TransformResult(BaseModel):
    """Result schema for data transformation test"""
    upper_case_names: list[str]
    total_price: float
    item_count: int


class ExtractionResult(BaseModel):
    """Result schema for data extraction test"""
    title: str
    item_count: int
    items: list[str]


class SortResult(BaseModel):
    """Result schema for sorting test"""
    sorted: list[int]


class FailureResult(BaseModel):
    """Result schema for failure test"""
    status: str


@pytest.mark.asyncio
async def test_investigate_error():
    """Test investigating an error with context"""
    from klendathu import investigate

    # Create an error
    try:
        data = {"user_id": 123}
        result = data["nonexistent_key"]
    except KeyError as error:
        # Investigate the error
        investigation = investigate({
            "error": error,
            "data": data,
        })

        # Get the investigation result
        result = await investigation

        # Verify we got a string result
        assert isinstance(result, str)
        assert len(result) > 0
        print(f"Investigation result: {result[:200]}...")


@pytest.mark.asyncio
async def test_investigate_with_context_item():
    """Test investigating error with ContextItem wrapper"""
    from klendathu import investigate, ContextItem

    try:
        x = 42
        y = x / 0  # ZeroDivisionError
    except Exception as error:
        investigation = investigate({
            "error": error,
            "x": ContextItem(x, "The dividend value"),
            "y": ContextItem(None, "The result we were computing"),
        })

        result = await investigation
        assert isinstance(result, str)
        assert len(result) > 0
        print(f"Investigation with context items: {result[:200]}...")


@pytest.mark.asyncio
async def test_investigate_stderr_iteration():
    """Test that we can iterate over stderr messages during investigation"""
    from klendathu import investigate

    try:
        undefined_var.nonexistent_method()
    except NameError as error:
        investigation = investigate({
            "error": error,
        })

        # Collect stderr messages
        messages = []
        async for msg in investigation.stderr:
            messages.append(msg)

        # Verify we got messages
        assert len(messages) > 0
        # Should have at least a server_started message
        assert any(m.get("type") == "server_started" for m in messages)
        print(f"Got {len(messages)} stderr messages")


@pytest.mark.asyncio
async def test_implement_data_transformation():
    """Test implementing data transformation with schema validation"""
    from klendathu import implement

    products = [
        {"name": "laptop", "price": 999.99},
        {"name": "mouse", "price": 29.99},
        {"name": "keyboard", "price": 79.99},
    ]

    result = await implement(
        """Transform the products data:
1. Extract all product names and convert them to uppercase
2. Calculate the total price of all products
3. Count the number of items""",
        {"products": products},
        TransformResult,
    )

    assert isinstance(result, TransformResult)
    assert result.upper_case_names == ["LAPTOP", "MOUSE", "KEYBOARD"]
    assert abs(result.total_price - 1109.97) < 0.01
    assert result.item_count == 3
    print(f"Transform result: {result}")


@pytest.mark.asyncio
async def test_implement_data_extraction():
    """Test implementing data extraction with nested schema"""
    from klendathu import implement

    sample_data = {
        "title": "Product List",
        "products": ["Laptop", "Mouse", "Keyboard", "Monitor", "Webcam"],
    }

    result = await implement(
        """Extract data from the page context and return it in the specified format:
- title: the page title
- item_count: the number of products
- items: the list of product names""",
        {"page_data": sample_data},
        ExtractionResult,
    )

    assert isinstance(result, ExtractionResult)
    assert result.title == "Product List"
    assert result.item_count == 5
    assert result.items == ["Laptop", "Mouse", "Keyboard", "Monitor", "Webcam"]
    print(f"Extraction result: {result}")


@pytest.mark.asyncio
async def test_implement_sorting():
    """Test implementing array sorting"""
    print("[TEST] Starting test_implement_sorting")
    from klendathu import implement

    unsorted_data = [64, 34, 25, 12, 22, 11, 90]
    print(f"[TEST] About to call implement with data: {unsorted_data}")

    result = await implement(
        "Sort the input array in descending order (highest to lowest).",
        {"input_array": unsorted_data},
        SortResult,
    )

    assert isinstance(result, SortResult)
    assert result.sorted == [90, 64, 34, 25, 22, 12, 11]
    print(f"Sorted result: {result}")


@pytest.mark.skip(reason="Flaky - agent doesn't always call fail_implementation")
def test_implement_failure():
    """Test that fail_implementation tool causes proper error"""
    from klendathu import implement

    async def run_test():
        try:
            result = await implement(
                """You cannot complete this task because no data has been provided.
Call the fail_implementation tool to report this.""",
                {},
                FailureResult,
            )
            # Should not reach here
            assert False, "Should have raised an error"
        except RuntimeError as e:
            # Should get error about implementation failure
            assert "Implementation failed" in str(e)
            print(f"Got expected failure: {e}")

    asyncio.run(run_test())


@pytest.mark.asyncio
async def test_implement_with_context_callable():
    """Test implement with ContextCallable for helper functions"""
    from klendathu import implement, ContextCallable

    def double_numbers(nums: list[int]) -> list[int]:
        """Helper function to double each number"""
        return [n * 2 for n in nums]

    class DoubleResult(BaseModel):
        doubled: list[int]

    result = await implement(
        """Use the double_numbers function to double each item in the list [1, 2, 3, 4, 5]""",
        {
            "numbers": [1, 2, 3, 4, 5],
            "double_numbers": ContextCallable(double_numbers, "Function that doubles a list of numbers"),
        },
        DoubleResult,
    )

    assert isinstance(result, DoubleResult)
    assert result.doubled == [2, 4, 6, 8, 10]
    print(f"Double result: {result}")


@pytest.mark.skip(reason="implement() does not return a promise with .summary property")
def test_implement_summary():
    """Test that we can get summary statistics from implement"""
    # TODO: Implement summary support for Python
    pass
