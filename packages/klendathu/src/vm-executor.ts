import vm from 'node:vm';
import { TRACE } from 'klendathu-utils/logging';
import type { z } from 'zod';

const serializeValue = (value: any): any => {
  if (value instanceof Error) {
    return {
      __error: true,
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return value.map(serializeValue);
    }
    const serialized: any = {};
    for (const [key, val] of Object.entries(value)) {
      serialized[key] = serializeValue(val);
    }
    return serialized;
  }
  return value;
};

export interface VmExecutor<Result = unknown> {
  eval(code: string): Promise<{ result: unknown; console?: Array<{ level: string; args: unknown[] }> }>;
  setResult(code: string): Promise<Result>;
  setBailError(message: string): void;
  getCompletion(): Promise<Result>;
}

export function createVmExecutor<Result = unknown>(
  context: Record<string, unknown>,
  schema: z.ZodType<Result>
): VmExecutor<Result> {
  TRACE`createVmExecutor called with schema keys: ${JSON.stringify(Object.keys(schema))} schema._def: ${!!schema._def}`;

  // Shared vars object that persists across all eval and setResult calls
  const vars = {};

  const vmContext = vm.createContext({
    context,
    vars,
    globalThis,
  });

  // Promise-based completion handling
  let resolveCompletion: ((result: Result) => void) | null = null;
  let rejectCompletion: ((error: Error) => void) | null = null;

  const completionPromise = new Promise<Result>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  return {
    async eval(code: string) {
      const consoleLogs: Array<{ level: string; args: any[] }> = [];
      const captureConsole = (level: string) => (...args: any[]) => {
        consoleLogs.push({ level, args });
      };

      const evalVmContext = vm.createContext({
        context,
        vars,
        globalThis,
        console: {
          log: captureConsole('log'),
          error: captureConsole('error'),
          warn: captureConsole('warn'),
          info: captureConsole('info'),
          debug: captureConsole('debug'),
          trace: captureConsole('trace'),
        },
      });

      const wrappedCode = `(async () => { const fn = ${code}; return await fn(); })()`;
      const result = await vm.runInContext(wrappedCode, evalVmContext);

      const output: any = {
        result: serializeValue(result),
      };

      if (consoleLogs.length > 0) {
        output.console = consoleLogs.map((log) => ({
          level: log.level,
          args: log.args.map(serializeValue),
        }));
      }

      return output;
    },

    async setResult(code: string) {
      // Code should be in the form: 'async () => { ... }'
      const wrappedCode = `(${code})()`;
      try {
        let value = await vm.runInContext(wrappedCode, vmContext);
        if (value instanceof Promise) {
          value = await value;
        }
        const serialized = serializeValue(value);

        // Validate against schema
        TRACE`Before safeParse - schema type: ${typeof schema}, has _def: ${!!schema._def}, has safeParse: ${!!schema.safeParse}`;
        TRACE`Before safeParse - serialized: ${JSON.stringify(serialized)}`;
        const validation = schema.safeParse(serialized);
        TRACE`After safeParse - success: ${validation.success}`;
        if (!validation.success) {
          const errorMessage = validation.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
          throw new Error(`Validation failed: ${errorMessage}`);
        }

        // Resolve the completion promise
        TRACE`Resolving completion promise with: ${JSON.stringify(serialized).substring(0, 100)}`;
        resolveCompletion!(serialized);
        TRACE`Completion promise resolved`;
        return serialized;
      } catch (err) {
        TRACE`setResult error: ${err}`;
        throw err;
      }
    },

    setBailError(message: string) {
      const error = new Error(`Agent could not complete the task: ${message}`);
      TRACE`setBailError called: ${error.message}`;
      rejectCompletion!(error);
    },

    getCompletion() {
      return completionPromise;
    },
  };
}
