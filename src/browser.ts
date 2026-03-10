/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {logger} from './logger.js';
import {DEFAULT_ARGS, STEALTH_ARGS, HARMFUL_ARGS} from './stealth-args.js';
import type {
  Browser,
  BrowserContext,
} from './third_party/index.js';
import {chromium} from './third_party/index.js';

export interface BrowserResult {
  browser: Browser | undefined;
  context: BrowserContext;
}

let browserResult: BrowserResult | undefined;

export async function ensureBrowserConnected(options: {
  browserURL?: string;
  wsEndpoint?: string;
  wsHeaders?: Record<string, string>;
  devtools: boolean;
  initScript?: string;
}): Promise<BrowserResult> {
  if (browserResult) {
    return browserResult;
  }

  let endpoint = options.wsEndpoint;

  // If browserURL is given (e.g. http://localhost:9222), resolve to ws endpoint
  if (!endpoint && options.browserURL) {
    const url = new URL('/json/version', options.browserURL);
    const res = await fetch(url.toString());
    const json = (await res.json()) as {webSocketDebuggerUrl: string};
    endpoint = json.webSocketDebuggerUrl;
  }

  if (!endpoint) {
    throw new Error('Either browserURL or wsEndpoint must be provided');
  }

  logger('Connecting Patchright via CDP to', endpoint);
  const browser = await chromium.connectOverCDP(endpoint, {
    headers: options.wsHeaders,
  });
  logger('Connected Patchright');

  const context = browser.contexts()[0];
  if (!context) {
    throw new Error('No browser context found after connecting');
  }

  if (options.initScript) {
    await context.addInitScript({content: options.initScript});
    // Also inject into all existing pages so the script is active on next navigation.
    // context.addInitScript only affects newly created pages.
    for (const page of context.pages()) {
      await page.addInitScript({content: options.initScript});
    }
  }

  browserResult = {browser, context};
  return browserResult;
}

interface McpLaunchOptions {
  acceptInsecureCerts?: boolean;
  executablePath?: string;
  channel?: Channel;
  userDataDir?: string;
  headless: boolean;
  isolated: boolean;
  logFile?: fs.WriteStream;
  viewport?: {
    width: number;
    height: number;
  };
  args?: string[];
  devtools: boolean;
  initScript?: string;
  hideCanvas?: boolean;
  blockWebrtc?: boolean;
  disableWebgl?: boolean;
  noStealth?: boolean;
}

export async function launch(options: McpLaunchOptions): Promise<BrowserResult> {
  const {channel, executablePath, headless, isolated} = options;
  const profileDirName =
    channel && channel !== 'stable'
      ? `chrome-profile-${channel}`
      : 'chrome-profile';

  let userDataDir = options.userDataDir;
  if (!isolated && !userDataDir) {
    userDataDir = path.join(
      os.homedir(),
      '.cache',
      'chrome-devtools-mcp',
      profileDirName,
    );
    await fs.promises.mkdir(userDataDir, {
      recursive: true,
    });
  }

  const args: string[] = [
    ...DEFAULT_ARGS,
    ...(options.noStealth ? [] : STEALTH_ARGS),
    ...(options.args ?? []),
    '--hide-crash-restore-bubble',
  ];
  if (headless) {
    args.push('--screen-info={3840x2160}');
  }
  if (options.devtools) {
    args.push('--auto-open-devtools-for-tabs');
  }
  if (options.hideCanvas) {
    args.push('--fingerprinting-canvas-image-data-noise');
  }
  if (options.blockWebrtc) {
    args.push(
      '--webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--force-webrtc-ip-handling-policy',
    );
  }
  if (options.disableWebgl) {
    args.push(
      '--disable-webgl',
      '--disable-webgl-image-chromium',
      '--disable-webgl2',
    );
  }

  // Resolve Chrome channel for Patchright
  let patchrightChannel: string | undefined;
  if (!executablePath) {
    if (channel === 'canary') {
      patchrightChannel = 'chrome-canary';
    } else if (channel === 'beta') {
      patchrightChannel = 'chrome-beta';
    } else if (channel === 'dev') {
      patchrightChannel = 'chrome-dev';
    } else {
      patchrightChannel = 'chrome';
    }
  }

  // Use viewport: null to disable Playwright's viewport emulation.
  // This exposes real OS window/screen dimensions (no fake 1920x1080).
  // Note: deviceScaleFactor is incompatible with viewport: null.
  const hasCustomViewport = !!options.viewport;
  const contextOptions = {
    viewport: hasCustomViewport ? options.viewport : null,
    ...(hasCustomViewport ? {
      screen: {width: options.viewport!.width, height: options.viewport!.height},
      deviceScaleFactor: 2,
    } : {}),
    colorScheme: 'dark' as const,
    isMobile: false,
    hasTouch: false,
    serviceWorkers: 'allow' as const,
    permissions: ['geolocation', 'notifications'] as string[],
    ignoreHTTPSErrors: options.acceptInsecureCerts ?? true,
  };

  try {
    let browser: Browser | undefined;
    let context: BrowserContext;

    if (userDataDir) {
      // Use launchPersistentContext for user data dir
      // This returns a BrowserContext directly (no separate Browser object)
      context = await chromium.launchPersistentContext(userDataDir, {
        channel: patchrightChannel,
        executablePath,
        headless,
        args,
        ignoreDefaultArgs: options.noStealth ? undefined : HARMFUL_ARGS,
        ...contextOptions,
      });
    } else {
      // Launch without persistent context
      browser = await chromium.launch({
        channel: patchrightChannel,
        executablePath,
        headless,
        args,
        ignoreDefaultArgs: options.noStealth ? undefined : HARMFUL_ARGS,
      });
      context = await browser.newContext(contextOptions);
      // Create initial page if none exists
      if (context.pages().length === 0) {
        await context.newPage();
      }
    }

    if (options.initScript) {
      await context.addInitScript({content: options.initScript});
    }

    return {browser, context};
  } catch (error) {
    if (
      userDataDir &&
      (error as Error).message.includes('The browser is already running')
    ) {
      throw new Error(
        `The browser is already running for ${userDataDir}. Use --isolated to run multiple browser instances.`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
}

export async function ensureBrowserLaunched(
  options: McpLaunchOptions,
): Promise<BrowserResult> {
  if (browserResult) {
    return browserResult;
  }
  browserResult = await launch(options);
  return browserResult;
}

export type Channel = 'stable' | 'canary' | 'beta' | 'dev';
