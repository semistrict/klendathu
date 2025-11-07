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
import { loadCachedTranscript } from './cache.js';

const mockedQuery = vi.mocked(query);
const mockedCreateServer = vi.mocked(createMcpServerWithHttpBackend);
const mockedUdsClient = vi.mocked(UdsHttpClient);
const mockedRender = vi.mocked(Mustache.render);
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
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    Object.defineProperty(process, 'argv', {
      value: ['node', 'cli.js', '/tmp/test.sock'],
      writable: true,
    });

    mockHttpClient = {
      get: vi.fn(),
      post: vi.fn(),
    };
    mockedUdsClient.mockImplementation(() => mockHttpClient);
    mockedRender.mockReturnValue('rendered prompt');
    mockedLoadCachedTranscript.mockReturnValue(null);
    mockedCreateServer.mockImplementation((httpClient, options) => {
      (createMockQuery as any).onSetResultCallback = options?.onSetResult;
      return {
        type: 'sdk',
        name: 'klendathu',
        instance: {} as any,
      };
    });
    mockedQuery.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('should use cached transcript when available with schema', async () => {
    const cachedTranscript = [
      {
        tool: 'set_result',
        code: 'async () => ({ value: 42 })',
        result: { error: false, data: { value: 42 } },
      },
    ];

    mockHttpClient.get.mockResolvedValue({
      data: {
        prompt: 'test prompt',
        schema: { value: { type: 'number' } },
        context: {},
      },
    });

    mockHttpClient.post.mockResolvedValue({
      data: { result: { value: 42 } },
    });

    mockedLoadCachedTranscript.mockReturnValue(cachedTranscript);

    await main({ udsPath: '/tmp/test.sock' });

    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ value: 42 }));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('should call Claude when cache is not available', async () => {
    const result = { value: 10 };

    mockHttpClient.get.mockResolvedValue({
      data: {
        prompt: 'test',
        schema: { value: { type: 'number' } },
        context: {},
      },
    });

    mockedLoadCachedTranscript.mockReturnValue(null);

    mockedQuery.mockReturnValue(
      createMockQuery(result, 'success', async function* () {
        (createMockQuery as any).onSetResultCallback?.(result);
        yield { type: 'result', subtype: 'success', result };
      })
    );

    await main({ udsPath: '/tmp/test.sock' });

    expect(mockedQuery).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(result));
  });
});
