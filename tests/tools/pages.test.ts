/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  listPages,
  newPage,
  selectPage,
  navigatePage,
} from '../../src/tools/pages.js';
import {withBrowser} from '../utils.js';

describe('pages', () => {
  describe('list_pages', () => {
    it('list pages', async () => {
      await withBrowser(async (response, context) => {
        await listPages.handler({params: {}}, response, context);
        assert.ok(response.includePages);
      });
    });
  });
  describe('new_page', () => {
    it('create a page', async () => {
      await withBrowser(async (response, context) => {
        assert.strictEqual(context.getPageByIdx(0), context.getSelectedPage());
        await newPage.handler(
          {params: {url: 'about:blank'}},
          response,
          context,
        );
        assert.strictEqual(context.getPageByIdx(1), context.getSelectedPage());
        assert.ok(response.includePages);
      });
    });
  });
  describe('select_page', () => {
    it('selects a page', async () => {
      await withBrowser(async (response, context) => {
        await context.newPage();
        assert.strictEqual(context.getPageByIdx(1), context.getSelectedPage());
        await selectPage.handler({params: {pageIdx: 0}}, response, context);
        assert.strictEqual(context.getPageByIdx(0), context.getSelectedPage());
        assert.ok(response.includePages);
      });
    });
  });
  describe('navigate_page', () => {
    it('navigates to correct page', async () => {
      await withBrowser(async (response, context) => {
        await navigatePage.handler(
          {params: {url: 'data:text/html,<div>Hello MCP</div>'}},
          response,
          context,
        );
        const page = context.getSelectedPage();
        assert.equal(
          await page.evaluate(() => document.querySelector('div')?.textContent),
          'Hello MCP',
        );
        assert.ok(response.includePages);
      });
    });

    it('throws an error if the page was closed not by the MCP server', async () => {
      await withBrowser(async (response, context) => {
        const page = await context.newPage();
        assert.strictEqual(context.getPageByIdx(1), context.getSelectedPage());
        assert.strictEqual(context.getPageByIdx(1), page);

        await page.close();

        try {
          await navigatePage.handler(
            {params: {url: 'data:text/html,<div>Hello MCP</div>'}},
            response,
            context,
          );
          assert.fail('should not reach here');
        } catch (err) {
          assert.strictEqual(
            err.message,
            'The selected page has been closed. Call list_pages to see open pages.',
          );
        }
      });
    });
    it('go back', async () => {
      await withBrowser(async (response, context) => {
        const page = context.getSelectedPage();
        await page.goto('data:text/html,<div>Hello MCP</div>');
        await navigatePage.handler({params: {type: 'back'}}, response, context);

        assert.equal(
          await page.evaluate(() => document.location.href),
          'about:blank',
        );
        assert.ok(response.includePages);
      });
    });
    it('go forward', async () => {
      await withBrowser(async (response, context) => {
        const page = context.getSelectedPage();
        await page.goto('data:text/html,<div>Hello MCP</div>');
        await page.goBack();
        await navigatePage.handler(
          {params: {type: 'forward'}},
          response,
          context,
        );

        assert.equal(
          await page.evaluate(() => document.querySelector('div')?.textContent),
          'Hello MCP',
        );
        assert.ok(response.includePages);
      });
    });
    it('reload', async () => {
      await withBrowser(async (response, context) => {
        const page = context.getSelectedPage();
        await page.goto('data:text/html,<div>Hello MCP</div>');
        await navigatePage.handler(
          {params: {type: 'reload'}},
          response,
          context,
        );

        assert.equal(
          await page.evaluate(() => document.location.href),
          'data:text/html,<div>Hello MCP</div>',
        );
        assert.ok(response.includePages);
      });
    });
    it('go forward with error', async () => {
      await withBrowser(async (response, context) => {
        await navigatePage.handler(
          {params: {type: 'forward'}},
          response,
          context,
        );

        assert.ok(
          response.responseLines
            .at(0)
            ?.startsWith('Unable to navigate forward in the selected page:'),
        );
        assert.ok(response.includePages);
      });
    });
    it('go back with error', async () => {
      await withBrowser(async (response, context) => {
        await navigatePage.handler({params: {type: 'back'}}, response, context);

        assert.ok(
          response.responseLines
            .at(0)
            ?.startsWith('Unable to navigate back in the selected page:'),
        );
        assert.ok(response.includePages);
      });
    });
  });
});
