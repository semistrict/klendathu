import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { main } from './cli.js';

// Mock external dependencies
vi.mock('@anthropic-ai/claude-agent-sdk');
vi.mock('./server.js');
vi.mock('./uds-client.js');
vi.mock('./cache.js');
vi.mock('./transcript.js');
vi.mock('mustache');
vi.mock('klendathu-utils/logging');

import { query } from '@anthropic-ai/claude-agent-sdk';
import { createMcpServerWithHttpBackend } from './server.js';
import { UdsHttpClient } from './uds-client.js';
import Mustache from 'mustache';
import { getCachePath, loadCachedTranscript } from './cache.js';

const mockedQuery = vi.mocked(query);
const mockedCreateServer = vi.mocked(createMcpServerWithHttpBackend);
const mockedUdsClient = vi.mocked(UdsHttpClient);
const mockedRender = vi.mocked(Mustache.render);
const mockedGetCachePath = vi.mocked(getCachePath);
const mockedLoadCachedTranscript = vi.mocked(loadCachedTranscript);

function createMockQuery(result: any = {}, subtype: string = 'success', customGenerator?: () => AsyncGenerator<any>) {
  if (customGenerator) {
    return {
      [Symbol.asyncIterator]: customGenerator,
    } as any;
  }
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'result', subtype, result };
    },
  } as any;
}

describe('main()', () => {
  let mockHttpClient: any;
  let exitSpy: any;
  let errorSpy: any;
  let logSpy: any;

  beforeEach(() => {
    // Mock console methods
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Mock process.argv
    Object.defineProperty(process, 'argv', {
      value: ['node', 'cli.js', '/tmp/test.sock'],
      writable: true,
    });

    // Mock HTTP client
    mockHttpClient = {
      get: vi.fn(),
      post: vi.fn(),
    };
    mockedUdsClient.mockImplementation(() => mockHttpClient);

    // Mock Mustache render
    mockedRender.mockReturnValue('rendered prompt');

    // Mock cache functions - default to no cache hit
    mockedGetCachePath.mockReturnValue('/tmp/cache.json');
    mockedLoadCachedTranscript.mockReturnValue(null);

    // Mock MCP server creation
    mockedCreateServer.mockImplementation((httpClient, options) => {
      (createMockQuery as any).onSetResultCallback = options?.onSetResult;
      return {
        type: 'sdk',
        name: 'klendathu',
        instance: {} as any,
      };
    });

    // Mock query
    mockedQuery.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  describe('Argument parsing', () => {
    it('should accept UDS path from command line argument', async () => {
      Object.defineProperty(process, 'argv', {
        value: ['node', 'cli.js', '/tmp/socket.sock'],
      });

      mockHttpClient.get.mockResolvedValue({
        data: { prompt: 'test', schema: {}, context: {} },
      });

      mockedQuery.mockReturnValue(createMockQuery());

      await main();

      expect(mockedUdsClient).toHaveBeenCalledWith('/tmp/socket.sock');
    });

    it('should accept UDS path from options parameter', async () => {
      Object.defineProperty(process, 'argv', {
        value: ['node', 'cli.js'],
      });

      mockHttpClient.get.mockResolvedValue({
        data: { prompt: 'test', schema: {}, context: {} },
      });

      mockedQuery.mockReturnValue(createMockQuery());

      await main({ udsPath: '/tmp/options-socket.sock' });

      expect(mockedUdsClient).toHaveBeenCalledWith('/tmp/options-socket.sock');
    });
  });

  describe('Task fetching', () => {
    it('should fetch task details from GET /task endpoint', async () => {
      const taskData = {
        prompt: 'Implement a function',
        schema: { fn: { type: 'string' } },
        context: { input: 'test' },
      };

      mockHttpClient.get.mockResolvedValue({ data: taskData });
      mockedQuery.mockReturnValue(createMockQuery({ fn: 'code' }));

      await main({ udsPath: '/tmp/test.sock' });

      expect(mockHttpClient.get).toHaveBeenCalledWith('/task');
    });
  });

  describe('Prompt rendering', () => {
    it('should render Mustache template with fetched task details', async () => {
      const taskData = {
        prompt: 'Implement a function',
        schema: { result: { type: 'string' } },
        context: { x: 5 },
      };

      mockHttpClient.get.mockResolvedValue({ data: taskData });
      mockedRender.mockReturnValue('rendered template');
      mockedQuery.mockReturnValue(createMockQuery({ fn: 'code' }));

      await main({ udsPath: '/tmp/test.sock' });

      expect(mockedRender).toHaveBeenCalled();
      const renderCall = mockedRender.mock.calls[0];
      expect(renderCall[1]).toEqual(taskData);
    });

    it('should handle all task fields in template', async () => {
      const taskData = {
        prompt: 'test prompt',
        schema: { field: { type: 'string' } },
        context: { var1: 'value1' },
      };

      mockHttpClient.get.mockResolvedValue({ data: taskData });
      mockedQuery.mockReturnValue(createMockQuery());

      await main({ udsPath: '/tmp/test.sock' });

      expect(mockedRender).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining(taskData)
      );
    });
  });

  describe('MCP server creation', () => {
    it('should create in-process MCP server with HTTP backend', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: { prompt: 'test', schema: {}, context: {} },
      });

      mockedQuery.mockReturnValue(createMockQuery());

      await main({ udsPath: '/tmp/test.sock' });

      expect(mockedCreateServer).toHaveBeenCalledWith(
        mockHttpClient,
        expect.objectContaining({
          onSetResult: expect.any(Function),
          abort: expect.any(Function),
        })
      );
    });
  });

  describe('Query execution', () => {
    it('should run query with correct config (preset, permissions, sdk)', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: { prompt: 'test', schema: {}, context: {} },
      });

      mockedQuery.mockReturnValue(
        createMockQuery({ value: 'test' }, 'success', async function* () {
          (createMockQuery as any).onSetResultCallback?.({ value: 'test' });
          yield { type: 'result', subtype: 'success', result: { value: 'test' } };
        })
      );

      await main({ udsPath: '/tmp/test.sock' });

      const queryCall = mockedQuery.mock.calls[0][0] as any;
      expect(queryCall.options.systemPrompt.preset).toBe('claude_code');
      expect(queryCall.options.permissionMode).toBe('bypassPermissions');
      expect(queryCall.options.mcpServers.debugger.type).toBe('sdk');
      expect(queryCall.options.mcpServers.debugger.instance).toBeDefined();
    });

    it('should output result to stdout on success', async () => {
      const resultValue = { fn: 'async () => 42' };

      mockHttpClient.get.mockResolvedValue({
        data: { prompt: 'test', schema: {}, context: {} },
      });

      mockedQuery.mockReturnValue(
        createMockQuery(resultValue, 'success', async function* () {
          (createMockQuery as any).onSetResultCallback?.(resultValue);
          yield { type: 'result', subtype: 'success', result: resultValue };
        })
      );

      await main({ udsPath: '/tmp/test.sock' });

      expect(logSpy).toHaveBeenCalledWith(JSON.stringify(resultValue));
    });

    it('should output empty result if set_result is never called', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: { prompt: 'test', schema: {}, context: {} },
      });

      mockedQuery.mockReturnValue(
        createMockQuery(null, 'user_error', async function* () {
          yield { type: 'text', text: 'something went wrong' };
          yield { type: 'result', subtype: 'user_error', result: null };
        })
      );

      await main({ udsPath: '/tmp/test.sock' });

      expect(logSpy).toHaveBeenCalledWith(JSON.stringify({}));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('should handle async generator with multiple messages', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: { prompt: 'test', schema: {}, context: {} },
      });

      mockedQuery.mockReturnValue(
        createMockQuery(undefined, 'success', async function* () {
          yield { type: 'text', text: 'thinking...' };
          yield { type: 'tool_call', name: 'eval', input: { code: '5 + 5' } };
          yield { type: 'tool_result', result: { output: 10 } };
          (createMockQuery as any).onSetResultCallback?.({ value: 10 });
          yield { type: 'result', subtype: 'success', result: { value: 10 } };
        })
      );

      await main({ udsPath: '/tmp/test.sock' });

      expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ value: 10 }));
    });

    it('should exit with error if query throws exception', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: { prompt: 'test', schema: {}, context: {} },
      });

      mockedQuery.mockImplementation(() => {
        throw new Error('Query initialization failed');
      });

      await main({ udsPath: '/tmp/test.sock' });

      expect(errorSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('Cache replay', () => {
    it('should replay all eval calls in order before set_result', async () => {
      const cachedTranscript = {
        success: true,
        calls: [
          {
            tool: 'eval',
            code: 'async () => { vars.x = 10; return vars.x; }',
            result: { error: false, data: { result: 10 } },
          },
          {
            tool: 'eval',
            code: 'async () => { vars.y = 20; return vars.y; }',
            result: { error: false, data: { result: 20 } },
          },
          {
            tool: 'set_result',
            code: 'async () => { return { sum: vars.x + vars.y }; }',
            result: { error: false, data: { sum: 30 } },
          },
        ],
      };

      mockHttpClient.get.mockResolvedValue({
        data: { prompt: 'test', schema: {}, context: {} },
      });
      mockHttpClient.post.mockResolvedValue({ data: { sum: 30 } });

      mockedLoadCachedTranscript.mockReturnValue(cachedTranscript);

      await main({ udsPath: '/tmp/test.sock' });

      // Verify evals were replayed in order
      const postCalls = mockHttpClient.post.mock.calls;
      expect(postCalls).toHaveLength(3);

      // First call: eval 1
      expect(postCalls[0][0]).toBe('/eval');
      expect(postCalls[0][1].code).toBe('async () => { vars.x = 10; return vars.x; }');

      // Second call: eval 2
      expect(postCalls[1][0]).toBe('/eval');
      expect(postCalls[1][1].code).toBe('async () => { vars.y = 20; return vars.y; }');

      // Third call: set_result via /complete
      expect(postCalls[2][0]).toBe('/complete');
      expect(postCalls[2][1].code).toBe('async () => { return { sum: vars.x + vars.y }; }');

      // Verify result was output
      expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ sum: 30 }));

      // Should exit with code 0
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('should skip non-eval calls when replaying', async () => {
      const cachedTranscript = {
        success: true,
        calls: [
          {
            tool: 'eval',
            code: 'async () => { vars.x = 5; return vars.x; }',
            result: { error: false, data: { result: 5 } },
          },
          {
            tool: 'some_other_tool', // This should be skipped
            code: 'ignore me',
            result: { error: false, data: {} },
          },
          {
            tool: 'set_result',
            code: 'async () => { return { x: vars.x }; }',
            result: { error: false, data: { x: 5 } },
          },
        ],
      };

      mockHttpClient.get.mockResolvedValue({
        data: { prompt: 'test', schema: {}, context: {} },
      });
      mockHttpClient.post.mockResolvedValue({ data: { x: 5 } });

      mockedLoadCachedTranscript.mockReturnValue(cachedTranscript);

      await main({ udsPath: '/tmp/test.sock' });

      const postCalls = mockHttpClient.post.mock.calls;
      expect(postCalls).toHaveLength(2); // Only eval and set_result, not the other tool

      expect(postCalls[0][0]).toBe('/eval');
      expect(postCalls[1][0]).toBe('/complete');
    });
  });

  describe('Integration', () => {
    it('should complete full happy path flow', async () => {
      const taskData = {
        prompt: 'Implement fibonacci',
        schema: { fn: { type: 'string' } },
        context: { n: 5 },
      };

      const result = { fn: 'function fibonacci(n) { ... }' };

      mockHttpClient.get.mockResolvedValue({ data: taskData });
      mockedQuery.mockReturnValue(
        createMockQuery(result, 'success', async function* () {
          yield { type: 'text', text: 'implementing...' };
          (createMockQuery as any).onSetResultCallback?.(result);
          yield { type: 'result', subtype: 'success', result };
        })
      );

      await main({ udsPath: '/tmp/test.sock' });

      expect(mockedUdsClient).toHaveBeenCalledWith('/tmp/test.sock');
      expect(mockHttpClient.get).toHaveBeenCalledWith('/task');
      expect(mockedRender).toHaveBeenCalled();
      expect(mockedCreateServer).toHaveBeenCalledWith(
        mockHttpClient,
        expect.objectContaining({
          onSetResult: expect.any(Function),
          abort: expect.any(Function),
        })
      );
      expect(mockedQuery).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(JSON.stringify(result));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('should pass correct prompt to query', async () => {
      const taskData = { prompt: 'test prompt', schema: {}, context: {} };
      const renderedPrompt = 'final rendered prompt';

      mockHttpClient.get.mockResolvedValue({ data: taskData });
      mockedRender.mockReturnValue(renderedPrompt);
      mockedQuery.mockReturnValue(createMockQuery());

      await main({ udsPath: '/tmp/test.sock' });

      const queryCall = mockedQuery.mock.calls[0][0] as any;
      expect(queryCall.prompt).toBe(renderedPrompt);
    });

    it('should not exit on successful completion', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: { prompt: 'test', schema: {}, context: {} },
      });

      mockedQuery.mockReturnValue(createMockQuery());

      await main({ udsPath: '/tmp/test.sock' });

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('should handle empty result object', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: { prompt: 'test', schema: {}, context: {} },
      });

      mockedQuery.mockReturnValue(createMockQuery());

      await main({ udsPath: '/tmp/test.sock' });

      expect(logSpy).toHaveBeenCalledWith(JSON.stringify({}));
    });
  });
});
