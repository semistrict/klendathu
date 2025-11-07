/**
 * End-to-end test for implement()
 *
 * This test demonstrates using implement() to execute tasks with provided context.
 * Similar to tools like Stagehand, we provide natural language descriptions
 * and the AI executes the task using the tools/objects in context.
 */

import { describe, it, expect } from 'vitest';
import { implement } from '@/index.js';
import { z } from 'zod';
import { chromium, type Browser, type Page } from 'playwright';

describe('implement() end-to-end', () => {
  it('should automate browser actions using Playwright', async () => {
    const testPageHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Form</title>
</head>
<body>
  <h1>Contact Form</h1>
  <form id="contact-form">
    <label for="name">Name:</label>
    <input type="text" id="name" name="name" />

    <label for="email">Email:</label>
    <input type="email" id="email" name="email" />

    <label for="message">Message:</label>
    <textarea id="message" name="message"></textarea>

    <button type="submit">Submit</button>
  </form>

  <div id="result" style="display:none;"></div>
</body>
</html>
    `;

    let browser: Browser | undefined;
    let page: Page | undefined;

    try {
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage();
      await page.setContent(testPageHtml);

      // Generate random result that's NOT in the HTML source
      const randomResult = `Success-${Math.random().toString(36).substring(7)}`;

      // Set up form handler in the page context that uses our random result
      await page.evaluate((resultText) => {
        document.getElementById('contact-form')!.addEventListener('submit', (e) => {
          e.preventDefault();
          const resultDiv = document.getElementById('result')!;
          resultDiv.textContent = resultText;
          resultDiv.style.display = 'block';
        });
      }, randomResult);

      const automationSchema = {
        resultText: z.string(),
        formFilled: z.boolean(),
      };

      // Agent gets the page object with Playwright API instructions
      const result = await implement(
        `automate the form
Steps:
1. Fill field #name with "John Doe"
2. Fill field #email with "john@example.com"
3. Fill field #message with "Hello, this is a test message"
4. Click the submit button
5. Wait for #result to appear with waitForSelector
6. Get the text content from #result
7. Return { resultText: <content>, formFilled: true }`,
        { page },
        automationSchema
      );

      console.log('=== Automation Result ===');
      console.log(JSON.stringify(result, null, 2));
      console.log(`Expected: ${randomResult}`);
      console.log('=== End Result ===');

      expect(result.formFilled).toBe(true);
      expect(result.resultText).toBe(randomResult);
    } finally {
      await page?.close();
      await browser?.close();
    }
  }, 60000);

  it('should transform data according to requirements', async () => {
    const transformSchema = {
      upperCaseNames: z.array(z.string()),
      totalPrice: z.number(),
      itemCount: z.number(),
    };

    const products = [
      { name: 'laptop', price: 999.99 },
      { name: 'mouse', price: 29.99 },
      { name: 'keyboard', price: 79.99 },
    ];

    const result = await implement(
      `Transform the products data:
1. Extract all product names and convert them to uppercase
2. Calculate the total price of all products
3. Count the number of items`,
      { products },
      transformSchema
    );

    console.log('=== Transform Result ===');
    console.log(JSON.stringify(result, null, 2));
    console.log('=== End Result ===');

    expect(result.upperCaseNames).toEqual(['LAPTOP', 'MOUSE', 'KEYBOARD']);
    expect(result.totalPrice).toBeCloseTo(1109.97, 2);
    expect(result.itemCount).toBe(3);
  }, 60000);

  it('should generate a data extraction function', async () => {
    // Simpler test: generate a function that extracts data from context
    const extractionSchema = {
      extractedData: z.object({
        title: z.string(),
        itemCount: z.number(),
        items: z.array(z.string()),
      }),
    };

    const sampleData = {
      page: {
        title: 'Product List',
        products: ['Laptop', 'Mouse', 'Keyboard', 'Monitor', 'Webcam'],
      },
    };

    const result = await implement(
      `Extract data from the page context and return it in the specified format:
- title: the page title
- itemCount: the number of products
- items: the list of product names`,
      { pageData: sampleData },
      extractionSchema
    );

    console.log('=== Extracted Data ===');
    console.log(JSON.stringify(result.extractedData, null, 2));
    console.log('=== End Extracted Data ===');

    expect(result.extractedData.title).toBe('Product List');
    expect(result.extractedData.itemCount).toBe(5);
    expect(result.extractedData.items).toEqual(['Laptop', 'Mouse', 'Keyboard', 'Monitor', 'Webcam']);
  }, 60000);

  it('should sort an array in descending order', async () => {
    const sortSchema = {
      sorted: z.array(z.number()),
    };

    const unsortedData = [64, 34, 25, 12, 22, 11, 90];

    const result = await implement(
      `Sort the input array in descending order (highest to lowest).`,
      { inputArray: unsortedData },
      sortSchema
    );

    console.log('=== Sorting Result ===');
    console.log(`Sorted Array: ${result.sorted}`);
    console.log('=== End Sorting Result ===');

    expect(result.sorted).toEqual([90, 64, 34, 25, 22, 12, 11]);
  }, 60000);
});
