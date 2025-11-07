import { describe, it, expect, vi } from 'vitest';
import { generateCombinedCode } from './transcript-codegen.js';
import type { ToolCall } from './transcript.js';

// Mock logging
vi.mock('klendathu-utils/logging');

describe('generateCombinedCode', () => {
  describe('basic functionality', () => {
    it('should generate code from a single set_result call', () => {
      const calls: ToolCall[] = [
        {
          tool: 'set_result',
          code: 'async () => ({ result: 42 })',
          result: { error: false, data: { result: 42 } },
        },
      ];

      const code = generateCombinedCode(calls);
      expect(code).toContain('async () => {');
      expect(code).toContain('return await (async () => ({ result: 42 }))()');
      expect(code).toContain('})');
    });

    it('should generate code from eval calls followed by set_result', () => {
      const calls: ToolCall[] = [
        {
          tool: 'eval',
          code: 'async () => { const x = 1; return { x }; }',
          result: { error: false, data: { x: 1 } },
        },
        {
          tool: 'set_result',
          code: 'async () => { return { final: 42 }; }',
          result: { error: false, data: { final: 42 } },
        },
      ];

      const code = generateCombinedCode(calls);
      expect(code).toContain('// eval call');
      expect(code).toContain('await (async () => { const x = 1; return { x }; })()');
      expect(code).toContain('// final set_result');
      expect(code).toContain('return await (async () => { return { final: 42 }; })()');
    });

    it('should generate code from multiple eval calls followed by set_result', () => {
      const calls: ToolCall[] = [
        {
          tool: 'eval',
          code: 'async () => { const x = 1; return x; }',
          result: { error: false, data: 1 },
        },
        {
          tool: 'eval',
          code: 'async () => { const y = 2; return y; }',
          result: { error: false, data: 2 },
        },
        {
          tool: 'set_result',
          code: 'async () => { return { sum: 3 }; }',
          result: { error: false, data: { sum: 3 } },
        },
      ];

      const code = generateCombinedCode(calls);
      const evalMatches = code.match(/\/\/ eval call/g);
      expect(evalMatches).toHaveLength(2);
      expect(code).toContain('// final set_result');
    });
  });

  describe('error handling', () => {
    it('should throw error when no successful calls', () => {
      const calls: ToolCall[] = [];
      expect(() => generateCombinedCode(calls)).toThrow('No successful calls in transcript');
    });

    it('should throw error when no set_result call', () => {
      const calls: ToolCall[] = [
        {
          tool: 'eval',
          code: 'async () => { return 1; }',
          result: { error: false, data: 1 },
        },
      ];

      expect(() => generateCombinedCode(calls)).toThrow('No successful set_result call in transcript');
    });

    it('should skip failed calls', () => {
      const calls: ToolCall[] = [
        {
          tool: 'eval',
          code: 'async () => { throw new Error("fail"); }',
          result: { error: true, message: 'fail', stack: '' },
        },
        {
          tool: 'eval',
          code: 'async () => { return 1; }',
          result: { error: false, data: 1 },
        },
        {
          tool: 'set_result',
          code: 'async () => { return { final: 42 }; }',
          result: { error: false, data: { final: 42 } },
        },
      ];

      const code = generateCombinedCode(calls);
      // Should only include the successful eval, not the failed one
      expect(code).not.toContain('throw new Error');
      expect(code).toContain('return 1');
      expect(code).toContain('final: 42');
    });

    it('should use the last successful set_result when multiple exist', () => {
      const calls: ToolCall[] = [
        {
          tool: 'set_result',
          code: 'async () => { return { old: 1 }; }',
          result: { error: false, data: { old: 1 } },
        },
        {
          tool: 'set_result',
          code: 'async () => { return { new: 2 }; }',
          result: { error: false, data: { new: 2 } },
        },
      ];

      const code = generateCombinedCode(calls);
      // Should only have one set_result call (the last one)
      const setResultMatches = code.match(/\/\/ final set_result/g);
      expect(setResultMatches).toHaveLength(1);
      expect(code).toContain('new: 2');
      expect(code).not.toContain('old: 1');
    });
  });

  describe('code structure', () => {
    it('should wrap everything in an async IIFE', () => {
      const calls: ToolCall[] = [
        {
          tool: 'set_result',
          code: 'async () => ({ x: 1 })',
          result: { error: false, data: { x: 1 } },
        },
      ];

      const code = generateCombinedCode(calls);
      expect(code).toMatch(/\(async\s*\(\)\s*=>\s*\{/);
      expect(code).toMatch(/\}\)$/);
    });

    it('should include proper comments for eval and set_result', () => {
      const calls: ToolCall[] = [
        {
          tool: 'eval',
          code: 'async () => { return 1; }',
          result: { error: false, data: 1 },
        },
        {
          tool: 'set_result',
          code: 'async () => { return { x: 1 }; }',
          result: { error: false, data: { x: 1 } },
        },
      ];

      const code = generateCombinedCode(calls);
      expect(code).toContain('// eval call');
      expect(code).toContain('// final set_result');
    });

    it('should preserve original code exactly', () => {
      const evalCode = 'async () => { const vars = {}; vars.x = 10; return vars; }';
      const setResultCode = 'async () => { return { result: vars.x * 2 }; }';

      const calls: ToolCall[] = [
        {
          tool: 'eval',
          code: evalCode,
          result: { error: false, data: { x: 10 } },
        },
        {
          tool: 'set_result',
          code: setResultCode,
          result: { error: false, data: { result: 20 } },
        },
      ];

      const code = generateCombinedCode(calls);
      expect(code).toContain(evalCode);
      expect(code).toContain(setResultCode);
    });
  });
});
