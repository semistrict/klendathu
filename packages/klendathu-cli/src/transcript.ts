import { z } from 'zod';
import { TRACE } from 'klendathu-utils/logging';
import { saveCachedTranscript } from './cache.js';
import { ToolResultSchema } from './server.js';

export const ToolCallSchema = z.object({
  tool: z.string(),
  code: z.string(),
  result: ToolResultSchema.optional(),
});

export const TranscriptDataSchema = z.object({
  success: z.boolean().default(false),
  task: z.object({
    prompt: z.string(),
    schema: z.unknown(),
    context: z.unknown(),
  }),
  messages: z.array(z.unknown()).optional(),
  calls: z.array(ToolCallSchema),
});

export interface ToolCall {
  tool: string;
  code: string;
  result: unknown;
}

export interface TranscriptData {
  success: boolean;
  task: {
    prompt: string;
    schema: any;
    context: any;
  };
  messages?: unknown[];
  calls: ToolCall[];
}

export class Transcript {
  private calls: ToolCall[] = [];
  private messages: unknown[] = [];
  private taskDetails: any = null;

  setTaskDetails(prompt: string, schema: any, context: any): void {
    this.taskDetails = { prompt, schema, context };
    TRACE`Set task details in transcript`;
  }

  record(tool: string, code: string, result: unknown): void {
    this.calls.push({ tool, code, result });
    TRACE`Recorded ${tool} call to transcript`;
  }

  recordMessage(message: unknown): void {
    this.messages.push(message);
    TRACE`Recorded agent message to transcript`;
  }

  async save(cachePath: string, success: boolean = false): Promise<void> {
    if (this.calls.length === 0 && this.messages.length === 0) {
      TRACE`No transcript data to save`;
      return;
    }

    if (!this.taskDetails) {
      TRACE`Warning: No task details set, saving data only`;
    }

    const data: TranscriptData = {
      success,
      task: this.taskDetails || { prompt: '', schema: null, context: null },
      messages: this.messages.length > 0 ? this.messages : undefined,
      calls: this.calls,
    };

    TRACE`Saving transcript with success=${success}, ${this.messages.length} messages and ${this.calls.length} calls to ${cachePath}`;
    saveCachedTranscript(cachePath, data);
  }

  getCalls(): ToolCall[] {
    return this.calls;
  }
}
