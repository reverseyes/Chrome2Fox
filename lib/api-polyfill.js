/**
 * Chrome API Polyfill for Firefox
 * This script is injected into converted Chrome extensions to provide
 * compatibility shims for commonly used Chrome-specific APIs.
 *
 * Firefox already supports the `chrome` namespace with callbacks,
 * so this polyfill focuses on filling gaps and edge cases.
 */

const APIPolyfill = (() => {
  'use strict';

  /**
   * Generate the polyfill source code to be injected into converted extensions
   * @returns {string} JavaScript source code for the polyfill
   */
  function generatePolyfillSource() {
    return `
// === Chrome2Fox API Polyfill ===
// Injected by Chrome2Fox to ensure Chrome extension compatibility in Firefox
(function() {
  'use strict';

  // Ensure chrome namespace exists (Firefox already provides it, but just in case)
  if (typeof chrome === 'undefined') {
    window.chrome = typeof browser !== 'undefined' ? browser : {};
  }

  // === runtime.lastError compatibility ===
  // Firefox uses promise rejections, Chrome uses runtime.lastError
  // This shim ensures chrome.runtime.lastError is populated on errors
  if (chrome.runtime && !chrome.runtime._chrome2foxPatched) {
    chrome.runtime._chrome2foxPatched = true;

    // Store original lastError descriptor
    const originalDescriptor = Object.getOwnPropertyDescriptor(chrome.runtime, 'lastError');

    let _lastError = null;
    Object.defineProperty(chrome.runtime, 'lastError', {
      get() {
        if (originalDescriptor && originalDescriptor.get) {
          return originalDescriptor.get.call(chrome.runtime) || _lastError;
        }
        return _lastError;
      },
      set(val) {
        _lastError = val;
      }
    });
  }

  // === chrome.runtime.getURL ===
  // Ensure it works for both moz-extension:// and chrome-extension:// schemes
  if (chrome.runtime && chrome.runtime.getURL) {
    const originalGetURL = chrome.runtime.getURL.bind(chrome.runtime);
    chrome.runtime.getURL = function(path) {
      return originalGetURL(path);
    };
  }

  // === chrome.action (MV3) / chrome.browserAction (MV2) bridge ===
  // Firefox supports both, but ensure they cross-reference
  if (chrome.action && !chrome.browserAction) {
    chrome.browserAction = chrome.action;
  } else if (chrome.browserAction && !chrome.action) {
    chrome.action = chrome.browserAction;
  }

  // === chrome.storage.session polyfill ===
  // Firefox added storage.session in 115, but older versions may not have it
  if (chrome.storage && !chrome.storage.session) {
    // Fallback to in-memory storage
    const sessionStore = {};
    chrome.storage.session = {
      get(keys, callback) {
        const result = {};
        const keyList = typeof keys === 'string' ? [keys] : (Array.isArray(keys) ? keys : Object.keys(keys || sessionStore));
        for (const k of keyList) {
          if (sessionStore[k] !== undefined) {
            result[k] = sessionStore[k];
          } else if (typeof keys === 'object' && !Array.isArray(keys) && keys[k] !== undefined) {
            result[k] = keys[k]; // default values
          }
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      },
      set(items, callback) {
        Object.assign(sessionStore, items);
        if (callback) callback();
        return Promise.resolve();
      },
      remove(keys, callback) {
        const keyList = typeof keys === 'string' ? [keys] : keys;
        for (const k of keyList) {
          delete sessionStore[k];
        }
        if (callback) callback();
        return Promise.resolve();
      },
      clear(callback) {
        for (const k of Object.keys(sessionStore)) {
          delete sessionStore[k];
        }
        if (callback) callback();
        return Promise.resolve();
      }
    };
  }

  // === chrome.tabs.query groupId filter ===
  // Firefox doesn't support tabGroups — strip groupId from queries
  if (chrome.tabs && chrome.tabs.query) {
    const originalQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = function(queryInfo, callback) {
      if (queryInfo && queryInfo.groupId !== undefined) {
        const cleaned = Object.assign({}, queryInfo);
        delete cleaned.groupId;
        return originalQuery(cleaned, callback);
      }
      return originalQuery(queryInfo, callback);
    };
  }

  // === chrome.scripting.executeScript compatibility ===
  // Firefox supports this in MV3, but some argument differences exist
  if (chrome.scripting && chrome.scripting.executeScript) {
    const originalExecute = chrome.scripting.executeScript.bind(chrome.scripting);
    chrome.scripting.executeScript = function(injection, callback) {
      // Firefox doesn't support 'world' property in older versions
      if (injection && injection.world && injection.world === 'MAIN') {
        console.warn('[Chrome2Fox] scripting.executeScript world:MAIN may not work in all Firefox versions');
      }
      return originalExecute(injection, callback);
    };
  }

  // === Declarative Content stub ===
  // Provide no-op stubs so extensions don't crash
  if (!chrome.declarativeContent) {
    chrome.declarativeContent = {
      PageStateMatcher: function(opts) { return opts; },
      ShowAction: function() { return {}; },
      ShowPageAction: function() { return {}; },
      onPageChanged: {
        addRules: function() { return Promise.resolve(); },
        removeRules: function() { return Promise.resolve(); },
        getRules: function() { return Promise.resolve([]); }
      }
    };
  }

  // === chrome.identity stub ===
  if (!chrome.identity) {
    chrome.identity = {
      getAuthToken(details, callback) {
        const err = { message: 'chrome.identity is not supported in Firefox. Use browser-native OAuth flows.' };
        if (callback) callback(undefined);
        return Promise.reject(err);
      },
      getProfileUserInfo(details, callback) {
        if (typeof details === 'function') { callback = details; }
        const info = { email: '', id: '' };
        if (callback) callback(info);
        return Promise.resolve(info);
      },
      launchWebAuthFlow(details, callback) {
        // Firefox supports browser.identity.launchWebAuthFlow
        if (typeof browser !== 'undefined' && browser.identity && browser.identity.launchWebAuthFlow) {
          return browser.identity.launchWebAuthFlow(details).then(url => {
            if (callback) callback(url);
            return url;
          }).catch(err => {
            if (callback) callback(undefined);
            throw err;
          });
        }
        const err = { message: 'chrome.identity.launchWebAuthFlow not available' };
        if (callback) callback(undefined);
        return Promise.reject(err);
      }
    };
  }

  // === chrome.offscreen stub ===
  if (!chrome.offscreen) {
    chrome.offscreen = {
      createDocument() { return Promise.resolve(); },
      closeDocument() { return Promise.resolve(); },
      hasDocument() { return Promise.resolve(false); },
      Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK', DOM_PARSER: 'DOM_PARSER', DOM_SCRAPING: 'DOM_SCRAPING' }
    };
    console.warn('[Chrome2Fox] chrome.offscreen is stubbed. Offscreen documents are not supported in Firefox.');
  }

  // === chrome.tabGroups stub ===
  if (!chrome.tabGroups) {
    chrome.tabGroups = {
      query() { return Promise.resolve([]); },
      get() { return Promise.reject(new Error('Tab groups not supported in Firefox')); },
      update() { return Promise.reject(new Error('Tab groups not supported in Firefox')); },
      move() { return Promise.reject(new Error('Tab groups not supported in Firefox')); },
      TAB_GROUP_ID_NONE: -1,
      Color: { GREY: 'grey', BLUE: 'blue', RED: 'red', YELLOW: 'yellow', GREEN: 'green', PINK: 'pink', PURPLE: 'purple', CYAN: 'cyan', ORANGE: 'orange' }
    };
  }

  // === chrome.sidePanel stub ===
  if (!chrome.sidePanel) {
    chrome.sidePanel = {
      setOptions() { return Promise.resolve(); },
      setPanelBehavior() { return Promise.resolve(); },
      getOptions() { return Promise.resolve({}); },
      open() { return Promise.resolve(); }
    };
    console.warn('[Chrome2Fox] chrome.sidePanel is stubbed. Side panels are not supported in Firefox (use sidebar_action instead).');
  }

  console.log('[Chrome2Fox] API polyfill loaded successfully');
})();
`;
  }

  /**
   * Get the polyfill filename used in converted extensions
   */
  function getPolyfillFilename() {
    return '_chrome2fox_polyfill.js';
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.APIPolyfill = { generatePolyfillSource, getPolyfillFilename };
  }

  return { generatePolyfillSource, getPolyfillFilename };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = APIPolyfill;
}
