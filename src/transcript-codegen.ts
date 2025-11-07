import { TRACE } from '@/utils/logging.js';
import type { ToolCall } from './transcript.js';

/**
 * Generates a single combined JavaScript function from a transcript.
 *
 * Takes all successful eval calls and the final set_result call,
 * combines them into a single async function that executes all steps
 * in sequence and returns the final result.
 */
export function generateCombinedCode(calls: ToolCall[]): string {
  // Filter to successful calls only
  const successfulCalls = calls.filter((call) => {
    const result = call.result as Record<string, unknown>;
    return result?.error !== true;
  });

  if (successfulCalls.length === 0) {
    throw new Error('No successful calls in transcript');
  }

  // Find the last set_result call
  const lastSetResult = [...successfulCalls]
    .reverse()
    .find((call) => call.tool === 'set_result');

  if (!lastSetResult) {
    throw new Error('No successful set_result call in transcript');
  }

  // Get all eval calls that come before the final set_result
  const lastSetResultIndex = successfulCalls.indexOf(lastSetResult);
  const callsBeforeFinal = successfulCalls.slice(0, lastSetResultIndex).filter((call) => call.tool === 'eval');

  TRACE`Generating combined code from ${callsBeforeFinal.length} eval calls + 1 final set_result`;

  // Build the combined code
  let combinedCode = '(async () => {';

  // Add each eval call inline
  for (const call of callsBeforeFinal) {
    // Extract the function body from the async function
    // Code is like: async () => { ... }
    // We need to extract just the body
    const functionBody = extractFunctionBody(call.code);
    TRACE`Adding eval call to combined code (body length: ${functionBody.length})`;
    combinedCode += `\n  // eval call\n  await (${call.code})();\n`;
  }

  // Add the final set_result
  TRACE`Adding final set_result call to combined code`;
  combinedCode += `\n  // final set_result\n  return await (${lastSetResult.code})();\n`;

  combinedCode += '\n})';

  TRACE`Generated combined code: ${combinedCode.length} characters`;
  return combinedCode;
}

/**
 * Extracts the body of an async function expression.
 * Input: async () => { ... }
 * Output: { ... }
 */
function extractFunctionBody(code: string): string {
  // Match: async () => { ... } or async () => ...
  const match = code.match(/async\s*\(\s*\)\s*=>\s*(\{[\s\S]*\}|\S[\s\S]*)/);
  if (match && match[1]) {
    return match[1];
  }
  return code;
}
