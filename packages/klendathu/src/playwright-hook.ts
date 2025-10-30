/**
 * Playwright hook for auto-investigation of test failures.
 * Load with: NODE_OPTIONS='--import=klendathu/playwright-hook' playwright test
 */

import { createRequire } from 'module';
import { investigate } from './launcher.js';

const require = createRequire(import.meta.url);
const Module = require('module');

const KLENDATHU_PATCHED = Symbol('klendathu.patched');

declare global {
  interface Function {
    [KLENDATHU_PATCHED]?: boolean;
  }
}

// Monkey-patch Module._load to intercept @playwright/test
const originalLoad = Module._load;

Module._load = function (request: string, parent: any, isMain: boolean) {
  let module = originalLoad.call(this, request, parent, isMain);

  // Check if this module has a test object
  if (module && module.test && !module.test[KLENDATHU_PATCHED]) {
    const { test: originalTest } = module;

    // Create wrapped test function
    const wrappedTest = function (this: any, title: string, testFn: any) {
      // Extend timeout before test runs
      if (typeof originalTest.setTimeout === 'function') {
        originalTest.setTimeout(300000);
      }

      return originalTest.call(this, title, async function (this: any, { page, context, browser, request }: any, testInfo: any) {
        try {
          // Call original test function with fixtures
          return await testFn.call(this, { page, context, browser, request }, testInfo);
        } catch (error) {
          console.error(`\n🐛 Playwright test "${title}" failed, investigating...\n`);

          try {
            const investigation = await investigate({
              error: error instanceof Error ? error : new Error(String(error)),
              page,
              context,
              browser,
              request,
              testTitle: title,
              extraInstructions: 'This is a Playwright test failure. You have access to the live browser via the `page` object in context. Use the eval MCP tool to inspect the DOM state: try `context.page.locator("#element-id").textContent()` or `context.page.evaluate(() => document.querySelector("#element-id")?.innerHTML)` to see actual rendered content. Compare the actual DOM state with expected values to diagnose the issue.'
            });

            console.error('\n📋 Klendathu Investigation:\n');
            console.error(investigation);
          } catch (err) {
            console.error('\n⚠️  Investigation failed:', err);
          }

          throw error;
        }
      });
    };

    // Copy all properties from original test
    Object.setPrototypeOf(wrappedTest, originalTest);
    Object.assign(wrappedTest, originalTest);
    wrappedTest[KLENDATHU_PATCHED] = true;

    // Wrap module in a Proxy to intercept test access
    module = new Proxy(module, {
      get(target, prop) {
        if (prop === 'test') {
          return wrappedTest;
        }
        return target[prop];
      }
    });

    // Also patch test.step if it exists
    if (typeof module.test.step === 'function') {
      const originalStep = module.test.step.bind(module.test);

      module.test.step = async function interceptedStep<T>(
        title: string,
        body: () => Promise<T>,
        options?: { box?: boolean }
      ): Promise<T> {
        try {
          return await originalStep(title, body, options);
        } catch (error) {
          console.error(`\n🐛 Playwright step "${title}" failed, investigating...\n`);

          if (typeof module.test.setTimeout === 'function') {
            module.test.setTimeout(300000);
          }

          try {
            const investigation = await investigate({
              error: error instanceof Error ? error : new Error(String(error)),
              stepTitle: title,
              extraInstructions: 'This is a Playwright test step failure. If you have access to the `page` object in context via eval MCP tool, use it to inspect the live DOM state and compare with expected values. Otherwise analyze the error and suggest how to fix the test.'
            });

            console.error('\n📋 Klendathu Investigation:\n');
            console.error(investigation);
          } catch (err) {
            console.error('\n⚠️  Investigation failed:', err);
          }

          throw error;
        }
      };

      module.test.step[KLENDATHU_PATCHED] = true;
    }
  }

  return module;
};
