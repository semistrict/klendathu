"""Example Python script demonstrating klendathu usage"""

import asyncio
import sys
import os

# Add the Python package to path for development
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages", "klendathu-py", "src"))

from klendathu import investigate, ContextItem


async def main():
    """Demonstrate investigating a Python error"""

    # Example 1: Basic error investigation
    print("Example 1: Investigating a basic error\n")

    user_id = 12345
    data = {"name": "Alice", "role": "admin"}

    try:
        # This will cause an error
        result = data["email"]  # KeyError: 'email' doesn't exist
    except Exception as error:
        print(f"Error occurred: {error}\n")
        print("Investigating with AI...\n")

        # Investigate the error
        investigation = investigate(
            {
                "error": error,
                "user_id": ContextItem(user_id, "The user ID that triggered this operation"),
                "data": ContextItem(data, "The user data dictionary"),
            },
            extra_instructions="Please explain what went wrong and how to fix it.",
        )

        # Wait for investigation to complete
        result = await investigation

        print("Investigation result:")
        print(result)
        print("\n" + "=" * 80 + "\n")

        # Get summary statistics
        summary = await investigation.summary
        print(f"Summary: {summary['turns']} turns, ${summary['cost']:.4f} cost")


if __name__ == "__main__":
    # Check for API key
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY environment variable not set")
        print("Get your API key from https://console.anthropic.com/")
        sys.exit(1)

    # Run the example
    asyncio.run(main())
