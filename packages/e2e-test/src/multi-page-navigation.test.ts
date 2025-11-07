/**
 * Multi-page navigation E2E test
 * Tests the agent's ability to navigate through multiple pages using Playwright,
 * read values from each page, and aggregate results
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { implement } from 'klendathu';
import { z } from 'zod';
import type { Browser, Page } from 'playwright';
import { startTestServer, stopTestServer, launchBrowser, createPage, cleanupBrowser } from './playwright-helpers';

describe('implement() multi-page navigation', () => {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let testServer: Awaited<ReturnType<typeof startTestServer>> | undefined;
  let baseUrl: string;

  beforeEach(async () => {
    // Set up test pages
    testServer = await startTestServer([
      {
        path: '/profile',
        html: `
<!DOCTYPE html>
<html>
<head><title>User Profile</title></head>
<body>
  <h1>User Profile</h1>
  <div id="user-name">John Smith</div>
  <div id="user-email">john.smith@example.com</div>
  <a href="/orders">View Orders</a>
</body>
</html>
        `,
      },
      {
        path: '/orders',
        html: `
<!DOCTYPE html>
<html>
<head><title>My Orders</title></head>
<body>
  <h1>My Orders</h1>
  <ul>
    <li><a href="/order/1001">Order #1001</a> - Pending</li>
    <li><a href="/order/1002">Order #1002</a> - Delivered</li>
    <li><a href="/order/1003">Order #1003</a> - Processing</li>
  </ul>
</body>
</html>
        `,
      },
      {
        path: '/order/1001',
        html: `
<!DOCTYPE html>
<html>
<head><title>Order Details</title></head>
<body>
  <h1>Order Details</h1>
  <div id="order-id">1001</div>
  <div id="order-date">2024-01-15</div>
  <div id="order-total">$234.99</div>
  <div id="order-status">Pending</div>
  <h2>Items</h2>
  <ul>
    <li>Wireless Mouse - $25.99</li>
    <li>USB-C Cable - $12.99</li>
    <li>Monitor Arm - $196.01</li>
  </ul>
  <a href="/orders">Back to Orders</a>
</body>
</html>
        `,
      },
    ]);

    baseUrl = testServer.baseUrl;
    browser = await launchBrowser();
    page = await createPage(browser);
  });

  afterEach(async () => {
    await cleanupBrowser(page, browser);
    if (testServer) {
      await stopTestServer(testServer.server);
    }
  });

  it('should navigate through multiple pages and aggregate data', async () => {
    const navigationSchema = {
      userName: z.string(),
      userEmail: z.string(),
      orderCount: z.number(),
      firstOrderId: z.string(),
      firstOrderTotal: z.string().describe('The total amount as a decimal number string (e.g. "234.99"), without currency symbol or dollar sign'),
      firstOrderItemCount: z.number(),
    };

    // Navigate to the starting page so the agent knows where to start
    await page!.goto(`${baseUrl}/profile`);

    const result = await implement(
      `You are on a profile page. Navigate through the e-commerce site and collect the requested info.`,
      { page },
      navigationSchema,
      {
        validate: (result) => {
          if (result.firstOrderTotal.includes('$')) {
            throw new Error('firstOrderTotal must not include dollar sign - strip currency symbols');
          }
        },
      }
    );

    expect(result.userName).toBe('John Smith');
    expect(result.userEmail).toBe('john.smith@example.com');
    expect(result.orderCount).toBe(3);
    expect(result.firstOrderId).toBe('1001');
    expect(result.firstOrderTotal).toBe('234.99');
    expect(result.firstOrderItemCount).toBe(3);
  }, 120000);
});
