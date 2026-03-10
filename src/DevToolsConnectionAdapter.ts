/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CDPConnection as devtools} from '../node_modules/chrome-devtools-frontend/mcp/mcp.js';

import type {CDPSession} from './third_party/index.js';

/**
 * Adapts a Playwright CDPSession to the DevTools CDPConnection interface.
 *
 * In Playwright, CDPSession doesn't expose connection(), id(), or wildcard event listeners.
 * Instead we use CDP Target.attachToTarget to manage sub-sessions, and register
 * specific event handlers for forwarding.
 *
 * For now, this is a simplified implementation that only supports the root session.
 * Child session management (for OOPIFs) can be added later via Target.attachedToTarget events.
 */
export class PuppeteerDevToolsConnection implements devtools.CDPConnection {
  readonly #session: CDPSession;
  readonly #observers = new Set<devtools.CDPConnectionObserver>();
  readonly #sessionId: string;
  readonly #childSessions = new Map<string, CDPSession>();
  readonly #eventHandlers = new Map<string, (...args: any[]) => void>();

  constructor(session: CDPSession, sessionId?: string) {
    this.#session = session;
    this.#sessionId = sessionId ?? 'root';

    // Register CDP event forwarding for the main session
    this.#startForwardingCdpEvents(session, this.#sessionId);

    // Listen for child session attachment
    this.#session.on('Target.attachedToTarget' as any, (event: any) => {
      const childSessionId = event.sessionId;
      // We can't create separate CDPSession objects from Playwright for auto-attached targets,
      // but we can track their session IDs for routing
      this.#childSessions.set(childSessionId, session);
    });

    this.#session.on('Target.detachedFromTarget' as any, (event: any) => {
      this.#childSessions.delete(event.sessionId);
    });
  }

  send<T extends devtools.Command>(
    method: T,
    params: devtools.CommandParams<T>,
    sessionId: string | undefined,
  ): Promise<{result: devtools.CommandResult<T>} | {error: devtools.CDPError}> {
    if (sessionId === undefined) {
      throw new Error(
        'Attempting to send on the root session. This must not happen',
      );
    }

    // For the main session or child sessions, route through our CDP session
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return this.#session
      .send(method as any, params as any)
      .then(result => ({result}))
      .catch(error => ({error})) as any;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  observe(observer: devtools.CDPConnectionObserver): void {
    this.#observers.add(observer);
  }

  unobserve(observer: devtools.CDPConnectionObserver): void {
    this.#observers.delete(observer);
  }

  #startForwardingCdpEvents(session: CDPSession, sessionId: string): void {
    // In Playwright, we can't use wildcard listeners like session.on('*', handler).
    // Instead, register handlers for commonly used CDP event domains.
    const cdpDomains = [
      'Debugger.scriptParsed',
      'Debugger.paused',
      'Debugger.resumed',
      'Network.requestWillBeSent',
      'Network.responseReceived',
      'Network.loadingFinished',
      'Network.loadingFailed',
      'Network.webSocketCreated',
      'Network.webSocketClosed',
      'Network.webSocketFrameSent',
      'Network.webSocketFrameReceived',
      'Runtime.consoleAPICalled',
      'Runtime.exceptionThrown',
      'Page.frameNavigated',
      'Page.frameStartedNavigating',
      'Page.loadEventFired',
      'Page.domContentEventFired',
      'Audits.issueAdded',
      'Target.attachedToTarget',
      'Target.detachedFromTarget',
      'Target.receivedMessageFromTarget',
    ];

    for (const eventName of cdpDomains) {
      const handler = (event: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        this.#observers.forEach(observer =>
          observer.onEvent({
            method: eventName as devtools.Event,
            sessionId,
            params: event,
          }),
        );
      };
      this.#eventHandlers.set(`${sessionId}:${eventName}`, handler);
      session.on(eventName as any, handler);
    }
  }
}
