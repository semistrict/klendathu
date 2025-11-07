import { describe, it, expect, vi } from 'vitest';
import { Transcript, TranscriptDataSchema, ToolCallSchema } from './transcript.js';

// Mock external dependencies
vi.mock('@anthropic-ai/claude-agent-sdk');
vi.mock('./uds-client.js');
vi.mock('./cache.js');
vi.mock('mustache');
vi.mock('klendathu-utils/logging');

import type { ToolResult } from './server.js';

describe('Transcript class', () => {
  describe('ToolCallSchema', () => {
    it('should validate valid tool calls', () => {
      const validCall = {
        tool: 'eval',
        code: '1 + 1',
        result: { error: false, data: 2 },
      };

      const result = ToolCallSchema.safeParse(validCall);
      expect(result.success).toBe(true);
    });

    it('should allow tool calls without result field', () => {
      const callWithoutResult = {
        tool: 'eval',
        code: '1 + 1',
      };

      const result = ToolCallSchema.safeParse(callWithoutResult);
      expect(result.success).toBe(true);
    });
  });

  describe('TranscriptDataSchema', () => {
    it('should validate valid transcript data', () => {
      const validTranscript = {
        task: {
          prompt: 'implement something',
          schema: { type: 'object' },
          context: { key: 'value' },
        },
        calls: [
          {
            tool: 'eval',
            code: '1 + 1',
            result: { error: false, data: 2 },
          },
        ],
      };

      const result = TranscriptDataSchema.safeParse(validTranscript);
      expect(result.success).toBe(true);
    });

    it('should reject transcript data missing task', () => {
      const invalidTranscript = {
        calls: [
          {
            tool: 'eval',
            code: '1 + 1',
            result: { error: false, data: 2 },
          },
        ],
      };

      const result = TranscriptDataSchema.safeParse(invalidTranscript);
      expect(result.success).toBe(false);
    });

    it('should allow calls without result field', () => {
      const transcript = {
        task: {
          prompt: 'test',
          schema: {},
          context: {},
        },
        calls: [
          {
            tool: 'eval',
            code: '1 + 1',
            // result is optional
          },
        ],
      };

      const result = TranscriptDataSchema.safeParse(transcript);
      expect(result.success).toBe(true);
    });
  });

  describe('Transcript instance', () => {
    it('should set and store task details', () => {
      const transcript = new Transcript();
      const prompt = 'implement a function';
      const schema = { type: 'object' };
      const context = { var1: 'value1' };

      transcript.setTaskDetails(prompt, schema, context);
      transcript.record('eval', 'return 42', { error: false, data: 42 });

      const calls = transcript.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        tool: 'eval',
        code: 'return 42',
        result: { error: false, data: 42 },
      });
    });

    it('should record multiple tool calls', () => {
      const transcript = new Transcript();
      transcript.setTaskDetails('test', {}, {});

      transcript.record('eval', 'const x = 1', { error: false, data: 1 });
      transcript.record('eval', 'const y = 2', { error: false, data: 2 });
      transcript.record('set_result', 'return x + y', { error: false, data: 3 });

      expect(transcript.getCalls()).toHaveLength(3);
    });
  });
});

describe('Transcript recording', () => {
  it('should record eval tool calls to transcript', () => {
    const transcript = new Transcript();
    const evalCode = '5 + 5';
    const evalResult: ToolResult = { error: false, data: 10 };

    transcript.setTaskDetails('test prompt', {}, {});
    transcript.record('eval', evalCode, evalResult);

    const calls = transcript.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      tool: 'eval',
      code: evalCode,
      result: evalResult,
    });
  });

  it('should record set_result tool calls to transcript', () => {
    const transcript = new Transcript();
    const setResultCode = 'async () => ({ value: 42 })';
    const setResultResult: ToolResult = { error: false, data: { value: 42 } };

    transcript.setTaskDetails('test prompt', {}, {});
    transcript.record('set_result', setResultCode, setResultResult);

    const calls = transcript.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      tool: 'set_result',
      code: setResultCode,
      result: setResultResult,
    });
  });

  it('should record tool call errors in transcript', () => {
    const transcript = new Transcript();
    const evalCode = 'throw new Error("test error")';
    const evalError: ToolResult = { error: true, message: 'test error', stack: 'Error: test error' };

    transcript.setTaskDetails('test prompt', {}, {});
    transcript.record('eval', evalCode, evalError);

    const calls = transcript.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].result).toEqual(evalError);
  });
});
