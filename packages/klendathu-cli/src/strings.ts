/**
 * Prompt templates for investigate and implement modes
 * Uses mustache templating - parameters match InvestigateInput and ImplementInput types
 */

export const INVESTIGATE_PROMPT_TEMPLATE = `Execution is currently paused at:

{{#callStack}}
{{filePath}}{{#line}}:{{line}}{{/line}}{{#column}}:{{column}}{{/column}}{{#functionName}} ({{functionName}}){{/functionName}}
{{/callStack}}

PID {{pid}} at {{timestamp}}

<available_context>
{{#context}}
- {{name}}: {{type}}{{#description}} - {{description}}{{/description}}
{{/context}}
</available_context>

<instructions>
You have access to an "eval" MCP tool that can execute JavaScript functions with access to the error context.

The eval tool accepts a "function" parameter containing a JavaScript function expression like: "async () => { return someVariable; }"

Available in the eval context:
- context: Object containing all captured context variables
- All Node.js globals: console, process, Buffer, Promise, etc.

Your investigation should:
1. Use eval to inspect context variables as needed
2. Use console.log() inside eval functions - all console output will be captured and returned to you

After your investigation, provide:
- A clear description of what happened
- The root cause based on the context
- Specific suggestions for how to fix it
</instructions>

Begin your investigation now.{{#extraInstructions}}

<additional_instructions>
{{extraInstructions}}
</additional_instructions>{{/extraInstructions}}`;

export const IMPLEMENT_PROMPT_TEMPLATE = `You are implementing functionality on behalf of a user.
YOU MUST CALL THE set_result TOOL WITH YOUR COMPLETED IMPLEMENTATION.

# Implementation Request

{{prompt}}

# Available Context

You will be given the following context variables:

{{#context}}
- {{name}}: {{type}}{{#description}} - {{description}}{{/description}}
{{/context}}

# Available Tools

You have access to the following MCP tools:

1. "eval" - Execute JavaScript to inspect context and test your implementation
   - Function format: "async () => { return someValue; }"
   - Has access to: context object, Node.js globals
   - Use console.log() for debugging - output will be captured
   - Use this to explore context and validate your logic

2. "set_result" - Set the final implementation result
   - Takes a function (sync or async) that receives context and returns the result
   - Function format: "(context) => ({ field1: value1, field2: value2 })" or "async (context) => ({ field1: value1, field2: value2 })"
   - The returned object MUST match the expected schema
   - YOU MUST CALL THIS TOOL BEFORE FINISHING
   - YOU MUST CALL THIS TOOL BEFORE FINISHING

# Implementation Workflow

Follow these steps to complete the implementation:

1. Use eval to explore the context and understand the available data
2. Design your implementation approach based on the requirements
3. Use eval to test your logic and verify correctness
4. Call set_result with a function that returns your final implementation
5. If validation fails, read the error message and call set_result again with corrections

IMPORTANT: The set_result tool is REQUIRED. Your task is not complete until you call it successfully.

Begin your implementation now.{{#extraInstructions}}

# Custom Instructions

Please keep the following custom instructions in mind when implementing.
If these instructions are not relevant to the current task, you may ignore them.

{{extraInstructions}}{{/extraInstructions}}`;
