/**
 * JavaScript init script for runtime anti-detection patches.
 *
 * These fix leaks that Chromium flags and Patchright cannot cover:
 * - Error.stack leaking "UtilityScript" (Playwright execution context)
 * - Missing chrome.runtime / chrome.app objects
 * - screen.availWidth/availHeight equal to screen.width/height
 * - window.outerHeight/outerWidth inconsistency with innerHeight/innerWidth
 */

export const STEALTH_INIT_SCRIPT = `
// === 1. Patch Error.stack to remove UtilityScript traces ===
(function() {
  const originalPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = function(error, stack) {
    const filteredStack = stack.filter(frame => {
      const fileName = frame.getFileName() || '';
      const funcName = frame.getFunctionName() || '';
      return !fileName.includes('UtilityScript') &&
             !funcName.includes('UtilityScript');
    });
    if (originalPrepareStackTrace) {
      return originalPrepareStackTrace(error, filteredStack);
    }
    return error.toString() + '\\n' + filteredStack.map(f => '    at ' + f.toString()).join('\\n');
  };

  // Also patch stack getter on Error.prototype
  const originalStackDesc = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
  if (originalStackDesc && originalStackDesc.get) {
    const originalGet = originalStackDesc.get;
    Object.defineProperty(Error.prototype, 'stack', {
      get: function() {
        const stack = originalGet.call(this);
        if (typeof stack === 'string') {
          return stack
            .split('\\n')
            .filter(line => !line.includes('UtilityScript'))
            .join('\\n');
        }
        return stack;
      },
      set: originalStackDesc.set,
      configurable: true,
    });
  }
})();

// === 2. Fix chrome.runtime and chrome.app ===
(function() {
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.runtime) {
    // Real Chrome has a runtime object with specific properties
    const runtime = {
      OnInstalledReason: {
        CHROME_UPDATE: 'chrome_update',
        INSTALL: 'install',
        SHARED_MODULE_UPDATE: 'shared_module_update',
        UPDATE: 'update',
      },
      OnRestartRequiredReason: {
        APP_UPDATE: 'app_update',
        OS_UPDATE: 'os_update',
        PERIODIC: 'periodic',
      },
      PlatformArch: {
        ARM: 'arm',
        ARM64: 'arm64',
        MIPS: 'mips',
        MIPS64: 'mips64',
        X86_32: 'x86-32',
        X86_64: 'x86-64',
      },
      PlatformNaclArch: {
        ARM: 'arm',
        MIPS: 'mips',
        MIPS64: 'mips64',
        X86_32: 'x86-32',
        X86_64: 'x86-64',
      },
      PlatformOs: {
        ANDROID: 'android',
        CROS: 'cros',
        LINUX: 'linux',
        MAC: 'mac',
        OPENBSD: 'openbsd',
        WIN: 'win',
      },
      RequestUpdateCheckStatus: {
        NO_UPDATE: 'no_update',
        THROTTLED: 'throttled',
        UPDATE_AVAILABLE: 'update_available',
      },
      connect: function() {}.bind(function() {}),
      sendMessage: function() {}.bind(function() {}),
      id: undefined,
    };

    // Make connect and sendMessage look native
    const fakeFn = function connect() { throw new TypeError("Error in invocation of runtime.connect(string extensionId, object connectInfo): chrome.runtime.connect() called from a webpage must specify an Extension ID (string) for its first argument."); };
    Object.defineProperty(runtime, 'connect', {
      value: fakeFn,
      writable: true,
      configurable: true,
      enumerable: true,
    });

    Object.defineProperty(window.chrome, 'runtime', {
      value: runtime,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  if (!window.chrome.app) {
    const app = {
      isInstalled: false,
      InstallState: {
        DISABLED: 'disabled',
        INSTALLED: 'installed',
        NOT_INSTALLED: 'not_installed',
      },
      RunningState: {
        CANNOT_RUN: 'cannot_run',
        READY_TO_RUN: 'ready_to_run',
        RUNNING: 'running',
      },
      getDetails: function getDetails() { return null; },
      getIsInstalled: function getIsInstalled() { return false; },
      runningState: function runningState() { return 'cannot_run'; },
    };

    Object.defineProperty(window.chrome, 'app', {
      value: app,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
})();

// === 3. Fix screen.availWidth/availHeight ===
// Real desktops have a dock/taskbar that reduces available height
(function() {
  try {
    // Typical macOS dock height ~70px, Windows taskbar ~40px
    const dockHeight = 55;
    const realAvailHeight = screen.height - dockHeight;
    Object.defineProperty(screen, 'availHeight', {
      get: function() { return realAvailHeight; },
      configurable: true,
    });
    // availTop accounts for menu bar on macOS (~25px)
    Object.defineProperty(screen, 'availTop', {
      get: function() { return 25; },
      configurable: true,
    });
  } catch(e) {}
})();

// === 4. Fix outerWidth/outerHeight to be consistent with innerWidth/innerHeight ===
(function() {
  try {
    // Real Chrome: outerHeight = innerHeight + browser chrome (~85px toolbar + tabs)
    // outerWidth = innerWidth + ~0-2px borders
    Object.defineProperty(window, 'outerHeight', {
      get: function() { return window.innerHeight + 85; },
      configurable: true,
    });
    Object.defineProperty(window, 'outerWidth', {
      get: function() { return window.innerWidth + 0; },
      configurable: true,
    });
  } catch(e) {}
})();

// === 5. Fix Notification.permission ===
// "granted" without user interaction is suspicious; "default" is more natural
(function() {
  try {
    const originalNotification = window.Notification;
    if (originalNotification) {
      Object.defineProperty(originalNotification, 'permission', {
        get: function() { return 'default'; },
        configurable: true,
      });
    }
  } catch(e) {}
})();

// === 6. Fix navigator.connection for realistic network ===
(function() {
  try {
    const conn = navigator.connection;
    if (conn) {
      Object.defineProperty(conn, 'effectiveType', {
        get: function() { return '4g'; },
        configurable: true,
      });
      Object.defineProperty(conn, 'rtt', {
        get: function() { return 50; },
        configurable: true,
      });
      Object.defineProperty(conn, 'downlink', {
        get: function() { return 10; },
        configurable: true,
      });
    }
  } catch(e) {}
})();
`;
