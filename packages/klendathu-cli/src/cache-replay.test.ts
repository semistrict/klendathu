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

describe('Cache replay', () => {
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

  it('should discard transcript and run agent if replay eval fails', async () => {
    const cachedTranscript = {
      success: true,
      calls: [
        {
          tool: 'eval',
          code: 'async () => { vars.x = 10; return vars.x; }',
          result: { error: false, data: { result: 10 } },
        },
        {
          tool: 'set_result',
          code: 'async () => { return { x: vars.x }; }',
          result: { error: false, data: { x: 10 } },
        },
      ],
    };

    const freshResult = { x: 99 };

    mockHttpClient.get.mockResolvedValue({
      data: { prompt: 'test', schema: {}, context: {} },
    });

    // First eval call fails (replay), but subsequent agent execution succeeds
    mockHttpClient.post.mockRejectedValueOnce(new Error('Eval failed on replay'));
    mockHttpClient.post.mockResolvedValueOnce({ data: freshResult }); // Agent calls set_result

    mockedLoadCachedTranscript.mockReturnValue(cachedTranscript);

    // Agent execution
    mockedQuery.mockReturnValue(
      createMockQuery(freshResult, 'success', async function* () {
        (createMockQuery as any).onSetResultCallback?.(freshResult);
        yield { type: 'result', subtype: 'success', result: freshResult };
      })
    );

    await main({ udsPath: '/tmp/test.sock' });

    // Should have called agent's query (not just returned cached result)
    expect(mockedQuery).toHaveBeenCalled();

    // Should output the fresh result, not the cached one
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(freshResult));

    // Should NOT exit on replay failure - falls through to agent
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should discard transcript and run agent if replay set_result fails', async () => {
    const cachedTranscript = {
      success: true,
      calls: [
        {
          tool: 'eval',
          code: 'async () => { vars.x = 10; return vars.x; }',
          result: { error: false, data: { result: 10 } },
        },
        {
          tool: 'set_result',
          code: 'async () => { return { x: vars.x }; }',
          result: { error: false, data: { x: 10 } },
        },
      ],
    };

    const freshResult = { x: 42 };

    mockHttpClient.get.mockResolvedValue({
      data: { prompt: 'test', schema: {}, context: {} },
    });

    // Eval succeeds, but set_result fails (replay)
    mockHttpClient.post.mockResolvedValueOnce({ data: { result: 10 } }); // eval succeeds
    mockHttpClient.post.mockRejectedValueOnce(new Error('Set result failed on replay')); // set_result fails
    mockHttpClient.post.mockResolvedValueOnce({ data: freshResult }); // Agent calls set_result

    mockedLoadCachedTranscript.mockReturnValue(cachedTranscript);

    // Agent execution
    mockedQuery.mockReturnValue(
      createMockQuery(freshResult, 'success', async function* () {
        (createMockQuery as any).onSetResultCallback?.(freshResult);
        yield { type: 'result', subtype: 'success', result: freshResult };
      })
    );

    await main({ udsPath: '/tmp/test.sock' });

    // Should have called agent's query
    expect(mockedQuery).toHaveBeenCalled();

    // Should output the fresh result
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(freshResult));
  });

  it('BUG: should detect error responses in eval and fall back to agent', async () => {
    const cachedTranscript = {
      success: true,
      calls: [
        {
          tool: 'eval',
          code: 'async () => { return await page.goto("http://localhost:64815/profile"); }',
          result: { error: false, data: { navigated: true } },
        },
        {
          tool: 'set_result',
          code: 'async () => { return { userName: "John" }; }',
          result: { error: false, data: { userName: 'John' } },
        },
      ],
    };

    mockHttpClient.get.mockResolvedValue({
      data: { prompt: 'test', schema: {}, context: {} },
    });

    // Eval returns error response (in response body, not thrown exception)
    // This simulates the bug: hardcoded port from cached transcript no longer exists
    // The response is RESOLVED (not REJECTED), so no error is thrown
    mockHttpClient.post.mockResolvedValueOnce({
      data: {
        error: true,
        message: 'page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:64815/profile',
        stack: 'Error stack',
      },
    });

    // BUG: Code doesn't check response.data.error, so it continues to /complete
    // The /complete call will use the cached result (which has stale data), not fallback
    mockHttpClient.post.mockResolvedValueOnce({
      data: { result: { userName: 'John' } }, // Returns cached result
    });

    mockedLoadCachedTranscript.mockReturnValue(cachedTranscript);

    await main({ udsPath: '/tmp/test.sock' });

    // BUG: The code outputs the stale cached result instead of running fresh agent
    // It should detect eval error and fall back, but instead:
    // 1. Eval returns error in response body
    // 2. Code doesn't check for error, continues silently
    // 3. Code calls /complete with cached result
    // 4. Returns stale data: { userName: 'John' } instead of running agent fresh
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ userName: 'John' })); // Stale cached data!
    expect(mockedQuery).not.toHaveBeenCalled(); // Agent never runs!

    // This test documents what IS happening (bug), not what SHOULD happen
    // The fix would make this assertion expect mockedQuery to be called
  });
});
