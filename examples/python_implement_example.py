"""Example demonstrating implement() with Pydantic models"""

import asyncio
import sys
import os

# Add the Python package to path for development
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "packages", "klendathu-py", "src"))

from klendathu import implement, ContextItem
from pydantic import BaseModel


class UserProfile(BaseModel):
    """User profile data model"""
    name: str
    age: int
    email: str
    role: str


class AnalysisResult(BaseModel):
    """Analysis result model"""
    summary: str
    recommendations: list[str]
    confidence: float


async def main():
    """Demonstrate using implement() with AI-generated structured data"""

    print("=" * 80)
    print("Example 1: Generate a user profile")
    print("=" * 80 + "\n")

    # Generate a user profile using AI
    result = implement(
        prompt="Create a realistic user profile for a software engineer named Alex",
        context={},
        model=UserProfile,
        extra_instructions="Make the data realistic and consistent"
    )

    user = await result
    print("Generated user profile:")
    print(f"  Name: {user['name']}")
    print(f"  Age: {user['age']}")
    print(f"  Email: {user['email']}")
    print(f"  Role: {user['role']}")

    print("\n" + "=" * 80)
    print("Example 2: Analyze error data")
    print("=" * 80 + "\n")

    # Example error data
    error_logs = [
        "Connection timeout after 30s",
        "Retry attempt 1 failed",
        "Retry attempt 2 failed",
        "Database connection lost",
    ]

    # Analyze the errors using AI
    analysis = implement(
        prompt="Analyze these error logs and provide a summary with recommendations",
        context={
            "error_logs": ContextItem(error_logs, "List of error messages from the system")
        },
        model=AnalysisResult,
        extra_instructions="Focus on root cause and actionable recommendations"
    )

    analysis_result = await analysis
    print("Analysis:")
    print(f"  Summary: {analysis_result['summary']}")
    print(f"  Confidence: {analysis_result['confidence']}")
    print("  Recommendations:")
    for rec in analysis_result['recommendations']:
        print(f"    - {rec}")

    print("\n" + "=" * 80)


if __name__ == "__main__":
    # Check for API key
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY environment variable not set")
        print("Get your API key from https://console.anthropic.com/")
        sys.exit(1)

    # Run the examples
    asyncio.run(main())
