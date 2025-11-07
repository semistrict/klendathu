/**
 * Playwright test helpers
 * Shared utilities for setting up browser, pages, and local test servers
 */

import { chromium, type Browser, type Page } from 'playwright';
import http from 'http';

export interface TestPageRoute {
  path: string;
  html: string;
}

/**
 * Start a local HTTP server serving test pages
 */
export async function startTestServer(
  routes: TestPageRoute[],
  port: number = 0
): Promise<{
  server: http.Server;
  port: number;
  baseUrl: string;
}> {
  const server = http.createServer((req, res) => {
    const route = routes.find((r) => r.path === req.url);

    if (route) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(route.html);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, 'localhost', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }

      const resolvedPort = address.port;
      const baseUrl = `http://localhost:${resolvedPort}`;
      resolve({ server, port: resolvedPort, baseUrl });
    });

    server.on('error', reject);
  });
}

/**
 * Stop a test server
 */
export async function stopTestServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Launch a browser for testing
 */
export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

/**
 * Create a new page in the browser
 */
export async function createPage(browser: Browser): Promise<Page> {
  return browser.newPage();
}

/**
 * Clean up a page and close browser
 */
export async function cleanupBrowser(page: Page | undefined, browser: Browser | undefined): Promise<void> {
  await page?.close();
  await browser?.close();
}
