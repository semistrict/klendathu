import { test as base, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create extended test with custom fixtures
const test = base.extend({
  // Custom fixture example (empty for now, just testing extend)
});

test.describe('Test App', () => {
  test.beforeEach(async ({ page }) => {
    const appPath = join(__dirname, 'index.html');
    await page.goto(`file://${appPath}`);
  });

  test('counter should increment by 1', async ({ page }) => {
    await test.step('click increment button', async () => {
      await page.click('#increment');
    });

    await test.step('verify counter is 1', async () => {
      const counter = await page.textContent('#counter');
      expect(counter).toBe('1'); // This will fail - actual value is 2
    });
  });

  test('should display user email', async ({ page }) => {
    await test.step('click fetch data button', async () => {
      await page.click('#fetch-data');
    });

    await test.step('verify email is displayed', async () => {
      const userInfo = await page.textContent('#user-info');
      expect(userInfo).toContain('alice@example.com'); // This will fail - email is undefined
    });
  });

  test('calculation should not produce Infinity', async ({ page }) => {
    await test.step('click calculate button', async () => {
      await page.click('#calculate');
    });

    await test.step('verify result is a finite number', async () => {
      const result = await page.textContent('#calculation-result');
      expect(result).not.toContain('Infinity'); // This will fail - result is Infinity
    });
  });

  test('form should capture email correctly', async ({ page }) => {
    await test.step('show registration form', async () => {
      await page.click('#submit-form');
      await page.waitForSelector('#registration-form', { state: 'visible' });
      // Wait for the dynamic ID rename to happen
      await page.waitForTimeout(200);
    });

    await test.step('fill form and submit', async () => {
      await page.fill('#username', 'testuser');
      // This will fail because the input ID was renamed from #email-input to #email-field-renamed
      await page.fill('#email-input', 'test@example.com');
      await page.click('#registration-form button[type="submit"]');
    });

    await test.step('verify email is captured', async () => {
      await page.waitForSelector('#form-status');
      const status = await page.textContent('#form-status');
      expect(status).toBe('Registered: testuser (test@example.com)');
    });
  });

  test('should find random number in page (verifies page access in step investigation)', async ({ page }) => {
    if (!process.env.TEST_RANDOM_NUMBER) {
      throw new Error('TEST_RANDOM_NUMBER environment variable must be set');
    }
    const randomNum = parseInt(process.env.TEST_RANDOM_NUMBER, 10);

    await test.step('inject random number into page', async () => {
      await page.evaluate((num) => {
        const div = document.createElement('div');
        div.id = 'random-value';
        div.textContent = `Random: ${num}`;
        document.body.appendChild(div);
      }, randomNum);
    });

    await test.step('verify random number matches', async () => {
      const text = await page.textContent('#random-value');
      // This will fail with wrong number, forcing investigation to use page object
      expect(text).toBe(`Random: ${randomNum + 1}`);
    });
  });
});
