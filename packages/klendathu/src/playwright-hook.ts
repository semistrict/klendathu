/**
 * Playwright hook for auto-investigation of test failures.
 * Load with: NODE_OPTIONS='--import=klendathu/playwright-hook' playwright test
 */

import { createRequire } from 'module';
import { AsyncLocalStorage } from 'async_hooks';
import type { Page, BrowserContext, Browser, APIRequestContext } from '@playwright/test';
import { investigate } from './launcher.js';
import { TRACE } from 'klendathu-utils/logging';

const require = createRequire(import.meta.url);
const Module = require('module');

TRACE`Playwright hook loaded`;

const KLENDATHU_PATCHED = Symbol('klendathu.patched');

interface PlaywrightFixtures {
  page: Page;
  context: BrowserContext;
  browser: Browser;
  request: APIRequestContext;
}

// AsyncLocalStorage to hold fixtures accessible to step handlers
const fixturesStorage = new AsyncLocalStorage<PlaywrightFixtures>();

// Global fallback: store current fixtures for this worker process
let currentFixtures: PlaywrightFixtures | null = null;

declare global {
  interface Function {
    [KLENDATHU_PATCHED]?: boolean;
  }
}

/**
 * Helper function to perform investigation on test/step failures
 * Ensures both test and step failures receive consistent context
 */
async function performInvestigation(
  error: Error,
  title: string,
  titleType: 'testTitle' | 'stepTitle',
  fixtures: PlaywrightFixtures
): Promise<string> {
  const params: any = {
    error,
    page: fixtures.page,
    context: fixtures.context,
    browser: fixtures.browser,
    request: fixtures.request,
    extraInstructions: titleType === 'testTitle'
      ? 'This is a Playwright test failure. You have access to the live browser via the `page` object in context. CRITICAL: You MUST test all assumptions using the page object before stating anything. Do NOT make suppositions - verify everything explicitly. If you think a selector is wrong, use eval to test the selector you believe is correct. Use `context.page.locator("#element-id").textContent()` or `context.page.evaluate(() => document.querySelector("#element-id")?.innerHTML)` to inspect actual DOM state. Test alternative selectors, check element visibility, verify actual vs expected values. Only report findings that you have explicitly confirmed via the page object.'
      : 'This is a Playwright test step failure. You have access to the live browser via the `page` object in context. CRITICAL: You MUST test all assumptions using the page object before stating anything. Do NOT make suppositions - verify everything explicitly. If you think a selector is wrong, use eval to test the selector you believe is correct. Use `context.page.locator("#element-id").textContent()` or `context.page.evaluate(() => document.querySelector("#element-id")?.innerHTML)` to inspect actual DOM state. Test alternative selectors, check element visibility, verify actual vs expected values. Only report findings that you have explicitly confirmed via the page object.'
  };
  params[titleType] = title;

  return investigate(params);
}

declare global {
  interface Function {
    [KLENDATHU_PATCHED]?: boolean;
  }
}

/**
 * Wrap a test object by replacing its internal function.
 * We can't use a Proxy because Playwright bypasses it after multiple extends.
 */
function wrapTestObject(originalTest: any, moduleName: string): any {
  if (originalTest[KLENDATHU_PATCHED]) {
    return originalTest;
  }

  TRACE`wrapTestObject called for module: ${moduleName}`;

  // Store the original function
  const originalTestFn = originalTest.bind(originalTest);

  // Create wrapper function that replaces the original
  const wrappedTestFn: any = function(title: string, testFn: any) {
    TRACE`Test wrapper called for: "${title}"`;

    // Extend timeout before test runs
    if (typeof wrappedTestFn.setTimeout === 'function') {
      wrappedTestFn.setTimeout(300000);
      TRACE`Set timeout to 300000ms for test: ${title}`;
    }

    // Call the original test with our wrapped test function
    return originalTestFn(title, async function (this: any, { page, context, browser, request }: any, testInfo: any) {
      TRACE`Starting test execution: ${title}`;

      // Store fixtures in ALS and global for access by step handlers
      const fixtures: PlaywrightFixtures = { page, context, browser, request };
      TRACE`Storing fixtures in ALS and global for test: ${title}`;
      currentFixtures = fixtures;

      return fixturesStorage.run(fixtures, async () => {
        TRACE`Inside ALS.run for test: ${title}`;

        try {
          // Call original test function with fixtures
          const result = await testFn.call(this, { page, context, browser, request }, testInfo);
          TRACE`Test passed: ${title}`;
          return result;
        } catch (error) {
          TRACE`Test failed: ${title}, error: ${error}`;
          console.error(`\n🐛 Playwright test "${title}" failed, investigating...\n`);

          try {
            TRACE`Starting investigation for test: ${title}`;
            const investigation = await performInvestigation(
              error instanceof Error ? error : new Error(String(error)),
              title,
              'testTitle',
              fixtures
            );

            TRACE`Investigation completed for test: ${title}`;
            console.error('\n📋 Klendathu Investigation:\n');
            console.error(investigation);
          } catch (err) {
            TRACE`Investigation failed for test: ${title}, error: ${err}`;
            console.error('\n⚠️  Investigation failed:', err);
          }

          TRACE`Re-throwing original error for test: ${title}`;
          throw error;
        }
      });
    });
  };

  // Copy all properties from original test to wrapped function
  Object.assign(wrappedTestFn, originalTest);

  // NOTE: We don't patch step here anymore - it's patched globally in Module._load
  // This ensures ALL extends (including double extends) get the patched version

  // Patch extend
  const originalExtend = originalTest.extend.bind(wrappedTestFn);
  wrappedTestFn.extend = function(fixtures: any) {
    TRACE`test.extend() called, wrapping extended test object`;
    const extendedTest = originalExtend(fixtures);
    // Recursively wrap the extended test
    return wrapTestObject(extendedTest, moduleName);
  };

  wrappedTestFn[KLENDATHU_PATCHED] = true;

  return wrappedTestFn;
}

// Store reference to original test.step for ALL test objects
let originalTestStep: any = null;

// Monkey-patch Module._load to intercept @playwright/test
const originalLoad = Module._load;

Module._load = function (request: string, parent: any, isMain: boolean) {
  let module = originalLoad.call(this, request, parent, isMain);

  // Check if this module has a test object
  if (module && module.test && !module.test[KLENDATHU_PATCHED]) {
    TRACE`Module._load intercepted module with test object: ${request}`;

    // CRITICAL: Patch test.step DIRECTLY on the original module.test object
    // This ensures ALL extends inherit the patched version
    if (!originalTestStep && typeof module.test.step === 'function') {
      originalTestStep = module.test.step;
      TRACE`Stored original test.step function, now patching it globally`;

      // Patch step directly on module.test so all extends inherit it
      module.test.step = async function<T>(
        stepTitle: string,
        body: () => Promise<T>,
        options?: { box?: boolean }
      ): Promise<T> {
        TRACE`Global patched test.step called: ${stepTitle}`;
        try {
          const result = await originalTestStep.call(this, stepTitle, body, options);
          TRACE`Test.step passed: ${stepTitle}`;
          return result;
        } catch (error) {
          TRACE`Test.step failed: ${stepTitle}, error: ${error}`;
          console.error(`\n🐛 Playwright step "${stepTitle}" failed, investigating...\n`);

          try {
            TRACE`Starting investigation for step: ${stepTitle}`;
            let fixtures = fixturesStorage.getStore();
            TRACE`Retrieved fixtures from ALS: ${fixtures ? 'found' : 'NOT FOUND'}`;
            if (!fixtures) {
              TRACE`Falling back to global currentFixtures: ${currentFixtures ? 'found' : 'NOT FOUND'}`;
              fixtures = currentFixtures || undefined;
            }

            if (!fixtures) {
              throw new Error('Fixtures not available: test wrapper never executed');
            }

            const investigation = await performInvestigation(
              error instanceof Error ? error : new Error(String(error)),
              stepTitle,
              'stepTitle',
              fixtures
            );

            TRACE`Investigation completed for step: ${stepTitle}`;
            console.error('\n📋 Klendathu Investigation:\n');
            console.error(investigation);
          } catch (err) {
            TRACE`Investigation failed for step: ${stepTitle}, error: ${err}`;
            console.error('\n⚠️  Investigation failed:', err);
          }

          TRACE`Re-throwing original error for step: ${stepTitle}`;
          throw error;
        }
      };
      TRACE`Global test.step patch applied`;
    }

    const wrappedTest = wrapTestObject(module.test, request);

    // Wrap module in a Proxy to intercept test access
    module = new Proxy(module, {
      get(target, prop) {
        if (prop === 'test') {
          TRACE`Module proxy returning wrappedTest for module: ${request}`;
          return wrappedTest;
        }
        return target[prop];
      }
    });
  }

  return module;
};
