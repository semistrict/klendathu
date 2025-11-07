import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { startServer } from './server.js';
import type { TaskContext } from './server.js';
import { createVmExecutor } from './vm-executor.js';

// Simple HTTP client for UDS
async function makeRequest<T = unknown>(
  socketPath: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path,
        method,
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode || 500,
              data: JSON.parse(data) as T,
            });
          } catch (err) {
            reject(new Error(`Failed to parse response: ${err}`));
          }
        });
      }
    );

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

describe('Server', () => {
  let socketPath: string;
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeEach(async () => {
    socketPath = join(tmpdir(), `klendathu-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);

    const taskContext: TaskContext = {
      instruction: 'Test instruction',
      context: {
        data: 'test data',
        number: 42,
      },
    };

    const vmExecutor = createVmExecutor(
      {
        data: 'test data',
        number: 42,
      },
      z.any()
    );

    server = await startServer(taskContext, vmExecutor, socketPath);
  });

  afterEach(async () => {
    await server.close();
  });

  describe('GET /task', () => {
    it('should return task details', async () => {
      const response = await makeRequest(socketPath, 'GET', '/task');

      expect(response.status).toBe(200);
      expect(response.data).toEqual({
        instruction: 'Test instruction',
        context: [],
        callStack: [],
      });
    });
  });

  describe('POST /eval', () => {
    it('should evaluate code and return result', async () => {
      const response = await makeRequest(socketPath, 'POST', '/eval', {
        code: '() => ({ sum: 2 + 2 })',
      });

      expect(response.status).toBe(200);
      expect(response.data).toEqual({
        result: { sum: 4 },
      });
    });

    it('should capture console output', async () => {
      const response = await makeRequest(socketPath, 'POST', '/eval', {
        code: '() => { console.log("hello"); return "done"; }',
      });

      const data = response.data as { result: unknown; console?: Array<{ level: string; args: unknown[] }> };
      expect(response.status).toBe(200);
      expect(data.result).toBe('done');
      expect(data.console).toBeDefined();
      expect(data.console![0]).toEqual({
        level: 'log',
        args: ['hello'],
      });
    });

    it('should handle errors', async () => {
      const response = await makeRequest(socketPath, 'POST', '/eval', {
        code: '() => { throw new Error("test error"); }',
      });

      const data = response.data as { error: boolean; message: string };
      expect(response.status).toBe(200);
      expect(data.error).toBe(true);
      expect(data.message).toContain('test error');
    });

    it('should access context in code', async () => {
      const response = await makeRequest(socketPath, 'POST', '/eval', {
        code: '() => context.data',
      });

      const data = response.data as { result: unknown };
      expect(response.status).toBe(200);
      expect(data.result).toBe('test data');
    });
  });

  describe('POST /complete', () => {
    it('should set result from code', async () => {
      const response = await makeRequest(socketPath, 'POST', '/complete', {
        code: 'async () => { const x = 10; return x * 5; }',
      });

      const data = response.data as { result: unknown };
      expect(response.status).toBe(200);
      expect(data.result).toBe(50);
    });

    it('should handle async code', async () => {
      const response = await makeRequest(socketPath, 'POST', '/complete', {
        code: 'async () => await Promise.resolve(42)',
      });

      const data = response.data as { result: unknown };
      expect(response.status).toBe(200);
      expect(data.result).toBe(42);
    });

    it('should handle errors gracefully', async () => {
      const response = await makeRequest(socketPath, 'POST', '/complete', {
        code: 'async () => { throw new Error("result error"); }',
      });

      const data = response.data as { result: unknown };
      expect(response.status).toBe(200);
      expect(data.result).toBeUndefined();
    });
  });

});
