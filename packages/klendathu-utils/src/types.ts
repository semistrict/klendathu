import { z } from 'zod';

// Location in the call stack
export const StackFrameSchema = z.object({
  filePath: z.string(),
  line: z.number().optional(),
  column: z.number().optional(),
  functionName: z.string().optional(),
});

export type StackFrame = z.infer<typeof StackFrameSchema>;

// Context item metadata (name, type, optional description)
export const ContextItemSchema = z.object({
  name: z.string(),
  type: z.string(), // e.g., "Error", "object", "string", "number", etc.
  description: z.string().optional(),
});

export type ContextItem = z.infer<typeof ContextItemSchema>;

// Base input that all modes share
const BaseInputSchema = z.object({
  mcpUrl: z.string(),
  callStack: z.array(StackFrameSchema),
  context: z.array(ContextItemSchema),
  timestamp: z.string(),
  pid: z.number(),
  extraInstructions: z.string().optional(),
});

// Investigate mode input
export const InvestigateInputSchema = BaseInputSchema.extend({
  mode: z.literal('investigate'),
});

// Implement mode input
export const ImplementInputSchema = BaseInputSchema.extend({
  mode: z.literal('implement'),
  prompt: z.string(),
  schema: z.record(z.unknown()), // ZodRawShape serialized as JSON
});

// Union of all input modes
export const CliInputSchema = z.discriminatedUnion('mode', [
  InvestigateInputSchema,
  ImplementInputSchema,
]);

export type CliInput = z.infer<typeof CliInputSchema>;
export type InvestigateInput = z.infer<typeof InvestigateInputSchema>;
export type ImplementInput = z.infer<typeof ImplementInputSchema>;

// Status protocol messages - all stderr output is JSON parseable
export const StatusMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('log'),
    message: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal('server_started'),
    url: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal('turn'),
    turnNumber: z.number(),
    stopReason: z.string().optional(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal('tool_call'),
    toolName: z.string(),
    input: z.record(z.unknown()),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal('tool_result'),
    toolName: z.string(),
    resultPreview: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal('summary'),
    turns: z.number(),
    cost: z.number(),
    finishReason: z.string().optional(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
    cachedInputTokens: z.number().optional(),
    toolCallsCount: z.number().optional(),
    warnings: z.array(z.string()).optional(),
    timestamp: z.string(),
  }),
]);

export type StatusMessage = z.infer<typeof StatusMessageSchema>;
export type Summary = Extract<StatusMessage, { type: 'summary' }>;
