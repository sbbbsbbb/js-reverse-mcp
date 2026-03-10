/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool, timeoutSchema} from './ToolDefinition.js';

// Default navigation timeout in milliseconds (10 seconds)
const DEFAULT_NAV_TIMEOUT = 10000;

export const listPages = defineTool({
  name: 'list_pages',
  description: `Get a list of pages open in the browser.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response) => {
    response.setIncludePages(true);
  },
});

export const selectPage = defineTool({
  name: 'select_page',
  description: `Select a page as a context for future tool calls.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  schema: {
    pageIdx: zod
      .number()
      .describe(
        'The index of the page to select. Call list_pages to list pages.',
      ),
  },
  handler: async (request, response, context) => {
    const page = context.getPageByIdx(request.params.pageIdx);
    await page.bringToFront();
    context.selectPage(page);
    response.setIncludePages(true);
  },
});

// Default referer for anti-detection (matches Scrapling's google_search=True behavior)
const DEFAULT_REFERER = 'https://www.google.com/';

export const newPage = defineTool({
  name: 'new_page',
  description: `Creates a new page and navigates to the specified URL. Waits for DOMContentLoaded event (not full page load). Default timeout is 10 seconds.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    url: zod.string().describe('URL to load in a new page.'),
    ...timeoutSchema,
  },
  handler: async (request, response, context) => {
    const page = await context.newPage();

    // Use plain goto without waitForEventsAfterAction to avoid creating
    // a CDP session during navigation. Anti-bot systems detect the extra
    // CDP session that WaitForHelper creates (Page.frameStartedNavigating listener).
    await page.goto(request.params.url, {
      timeout: request.params.timeout ?? DEFAULT_NAV_TIMEOUT,
      waitUntil: 'domcontentloaded',
      referer: DEFAULT_REFERER,
    });

    response.setIncludePages(true);
  },
});

export const navigatePage = defineTool({
  name: 'navigate_page',
  description: `Navigates the currently selected page to a URL, or performs back/forward/reload navigation. Waits for DOMContentLoaded event (not full page load). Default timeout is 10 seconds.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    type: zod
      .enum(['url', 'back', 'forward', 'reload'])
      .optional()
      .describe(
        'Navigate the page by URL, back or forward in history, or reload.',
      ),
    url: zod.string().optional().describe('Target URL (only type=url)'),
    ignoreCache: zod
      .boolean()
      .optional()
      .describe('Whether to ignore cache on reload.'),
    ...timeoutSchema,
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const options = {
      timeout: request.params.timeout ?? DEFAULT_NAV_TIMEOUT,
    };

    if (!request.params.type && !request.params.url) {
      throw new Error('Either URL or a type is required.');
    }

    if (!request.params.type) {
      request.params.type = 'url';
    }

    // Use plain navigation without waitForEventsAfterAction to avoid creating
    // a CDP session during navigation. Anti-bot systems detect the extra
    // CDP session that WaitForHelper creates (Page.frameStartedNavigating listener).
    switch (request.params.type) {
      case 'url':
        if (!request.params.url) {
          throw new Error('A URL is required for navigation of type=url.');
        }
        try {
          await page.goto(request.params.url, {
            ...options,
            waitUntil: 'domcontentloaded',
            referer: DEFAULT_REFERER,
          });
          response.appendResponseLine(
            `Successfully navigated to ${request.params.url}.`,
          );
        } catch (error) {
          response.appendResponseLine(
            `Unable to navigate in the  selected page: ${error.message}.`,
          );
        }
        break;
      case 'back':
        try {
          await page.goBack({
            ...options,
            waitUntil: 'domcontentloaded',
          });
          response.appendResponseLine(
            `Successfully navigated back to ${page.url()}.`,
          );
        } catch (error) {
          response.appendResponseLine(
            `Unable to navigate back in the selected page: ${error.message}.`,
          );
        }
        break;
      case 'forward':
        try {
          await page.goForward({
            ...options,
            waitUntil: 'domcontentloaded',
          });
          response.appendResponseLine(
            `Successfully navigated forward to ${page.url()}.`,
          );
        } catch (error) {
          response.appendResponseLine(
            `Unable to navigate forward in the selected page: ${error.message}.`,
          );
        }
        break;
      case 'reload':
        try {
          // For ignoreCache, use CDP Page.reload directly
          if (request.params.ignoreCache) {
            const session = await context.getSelectedPage().context().newCDPSession(page);
            await session.send('Page.reload', {ignoreCache: true});
            await page.waitForLoadState('domcontentloaded', {timeout: options.timeout});
            await session.detach();
          } else {
            await page.reload({
              ...options,
              waitUntil: 'domcontentloaded',
            });
          }
          response.appendResponseLine(`Successfully reloaded the page.`);
        } catch (error) {
          response.appendResponseLine(
            `Unable to reload the selected page: ${error.message}.`,
          );
        }
        break;
    }

    response.setIncludePages(true);
  },
});
