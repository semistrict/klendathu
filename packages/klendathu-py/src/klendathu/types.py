"""Type definitions for klendathu"""

from typing import Any, AsyncIterator, Protocol, TypedDict, Literal, Union
from datetime import datetime


class StackFrame(TypedDict, total=False):
    """Location in the call stack"""

    filePath: str
    line: int
    column: int
    functionName: str


class ContextItemType(TypedDict, total=False):
    """Context item metadata"""

    name: str
    type: str
    description: str


class DebugContext(TypedDict):
    """Context captured for debugging"""

    context: dict[str, Any]
    contextDescriptions: dict[str, str]
    timestamp: str
    pid: int


class LogMessage(TypedDict):
    """Log status message"""

    type: Literal["log"]
    message: str
    timestamp: str


class ServerStartedMessage(TypedDict):
    """Server started status message"""

    type: Literal["server_started"]
    url: str
    timestamp: str


class TurnMessage(TypedDict, total=False):
    """Turn completed status message"""

    type: Literal["turn"]
    turnNumber: int
    stopReason: str
    timestamp: str


class ToolCallMessage(TypedDict):
    """Tool call status message"""

    type: Literal["tool_call"]
    toolName: str
    input: dict[str, Any]
    timestamp: str


class ToolResultMessage(TypedDict):
    """Tool result status message"""

    type: Literal["tool_result"]
    toolName: str
    resultPreview: str
    timestamp: str


class Summary(TypedDict, total=False):
    """Final summary statistics"""

    type: Literal["summary"]
    turns: int
    cost: float
    finishReason: str
    inputTokens: int
    outputTokens: int
    totalTokens: int
    reasoningTokens: int
    cachedInputTokens: int
    toolCallsCount: int
    warnings: list[str]
    timestamp: str


StatusMessage = Union[
    LogMessage,
    ServerStartedMessage,
    TurnMessage,
    ToolCallMessage,
    ToolResultMessage,
    Summary,
]


class DebuggerPromise(Protocol):
    """Promise that resolves to Claude's analysis with streaming status info"""

    def __await__(self):
        """Await the investigation result"""
        ...

    @property
    def stderr(self) -> AsyncIterator[StatusMessage]:
        """Stream of structured status messages as investigation progresses"""
        ...

    @property
    def summary(self) -> "DebuggerPromise":
        """Promise that resolves to summary statistics"""
        ...
