import express, { Request, Response } from 'express';
import { existsSync, unlinkSync, chmodSync } from 'node:fs';
import { TRACE } from 'klendathu-utils/logging';
import type { VmExecutor } from './vm-executor.js';

export type TaskContext = {
  context: Record<string, unknown>;
  instruction: string;
  schema?: unknown; // JSON Schema for the expected output
  contextItems?: Array<{ name: string; type: string; description?: string }>;
  callStack?: Array<{ filePath: string; line?: number; column?: number; functionName?: string }>;
  timestamp?: string;
  pid?: number;
};

/**
 * Creates an Express server for the implement/debug task
 */
export function createExpressServer<Result = unknown>(
  taskContext: TaskContext,
  vmExecutor: VmExecutor<Result>,
  validate?: (result: Result) => void | Promise<void>
): express.Application {
  const app = express();

  app.use(express.json());

  // GET /task
  app.get('/task', (req: Request, res: Response) => {
    TRACE`GET /task called`;
    res.json({
      instruction: taskContext.instruction,
      schema: taskContext.schema,
      context: taskContext.contextItems || [],
      callStack: taskContext.callStack || [],
      timestamp: taskContext.timestamp,
      pid: taskContext.pid,
    });
  });

  // POST /eval
  app.post('/eval', async (req: Request, res: Response) => {
    TRACE`POST /eval called`;
    try {
      const { code } = req.body as { code: string };
      const result = await vmExecutor.eval(code);
      res.json(result);
    } catch (error) {
      TRACE`eval error: ${error}`;
      res.json({
        error: true,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  });

  // POST /complete - handles both success (set_result) and failure (bail)
  app.post('/complete', async (req: Request, res: Response) => {
    TRACE`POST /complete called with body: ${JSON.stringify(req.body).substring(0, 100)}`;

    // Check if this is a failure request (from bail)
    if (req.body.failure) {
      const { message } = req.body as { failure: boolean; message: string };
      TRACE`Complete with failure: ${message}`;
      vmExecutor.setBailError(message);
      res.json({ error: true, message });
      return;
    }

    // Otherwise it's a success request (from set_result)
    try {
      const { code } = req.body as { code: string };
      const result = await vmExecutor.setResult(code);

      // Run validation if provided
      if (validate) {
        await validate(result as Result);
      }

      res.json({ result });
    } catch (error) {
      TRACE`complete error: ${error}`;
      res.json({
        error: true,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  });

  return app;
}

/**
 * Starts an Express server on a Unix Domain Socket
 */
export async function startServer<Result = unknown>(
  taskContext: TaskContext,
  vmExecutor: VmExecutor<Result>,
  socketPath: string,
  signal?: AbortSignal,
  validate?: (result: Result) => void | Promise<void>
): Promise<{ close: () => Promise<void>; [Symbol.asyncDispose]: () => Promise<void> }> {
  const app = createExpressServer<Result>(taskContext, vmExecutor, validate);

  // Clean up existing socket file
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  // Serve on UDS
  const { createServer } = await import('node:http');
  const httpServer = createServer(app);

  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(socketPath, () => resolve());
  });

  // Make socket readable/writable by owner
  chmodSync(socketPath, 0o600);

  TRACE`Server listening on ${socketPath}`;

  const closeServer = () => {
    return new Promise<void>((resolve, reject) => {
      httpServer.close((err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  // Handle abort signal
  if (signal) {
    signal.addEventListener(
      'abort',
      () => {
        closeServer().catch(console.error);
      },
      { once: true }
    );
  }

  return {
    close: closeServer,
    [Symbol.asyncDispose]: closeServer,
  };
}
