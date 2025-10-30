/**
 * ESM loader hook for intercepting @playwright/test imports
 */

import { investigate } from './launcher.js';

const KLENDATHU_PATCHED = Symbol('klendathu.patched');

declare global {
  interface Function {
    [KLENDATHU_PATCHED]?: boolean;
  }
}

export async function load(url: string, context: any, nextLoad: any) {
  const result = await nextLoad(url, context);

  // Intercept @playwright/test module
  if (url.includes('@playwright/test')) {
    const module = await import(url);
    const { test } = module;

    if (test && test.step && !test.step[KLENDATHU_PATCHED]) {
      const originalStep = test.step.bind(test);

      test.step = async function interceptedStep<T>(
        title: string,
        body: () => Promise<T>,
        options?: { box?: boolean }
      ): Promise<T> {
        try {
          return await originalStep(title, body, options);
        } catch (error) {
          console.error(`\n🐛 Playwright step "${title}" failed, investigating...\n`);

          // Launch investigation in the background
          const investigation = investigate({
            error: error instanceof Error ? error : new Error(String(error)),
            stepTitle: title,
            extraInstructions: 'This is a Playwright test step failure. Analyze the error and suggest how to fix the test.'
          });

          // Don't await - let investigation run while test continues to fail
          investigation.then(
            (result) => {
              console.error('\n📋 Klendathu Investigation:\n');
              console.error(result);
            },
            (err) => {
              console.error('\n⚠️  Investigation failed:', err);
            }
          );

          // Re-throw the original error so the test still fails
          throw error;
        }
      };

      // Mark as patched to avoid double-patching
      test.step[KLENDATHU_PATCHED] = true;
    }
  }

  return result;
}
