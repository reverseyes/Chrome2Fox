/**
 * Manifest Converter Module
 * Transforms Chrome extension manifest.json into Firefox-compatible format.
 * Generates a compatibility report for unsupported features.
 */

const ManifestConverter = (() => {
  'use strict';

  // Chrome-only permissions that Firefox doesn't support
  const UNSUPPORTED_PERMISSIONS = new Set([
    'debugger',
    'declarativeContent',
    'declarativeNetRequestFeedback',
    'enterprise.deviceAttributes',
    'enterprise.hardwarePlatform',
    'enterprise.networkingAttributes',
    'enterprise.platformKeys',
    'fileBrowserHandler',
    'fileSystemProvider',
    'fontSettings',
    'gcm',
    'identity',
    'identity.email',
    'documentScan',
    'loginState',
    'platformKeys',
    'printing',
    'printingMetrics',
    'processes',
    'sessions',
    'signedInDevices',
    'tabGroups',
    'ttsEngine',
    'wallpaper',
    'system.cpu',
    'system.memory',
  ]);

  // Permissions that are partially supported (work but with caveats)
  const PARTIAL_PERMISSIONS = new Map([
    ['webRequestBlocking', 'Firefox supports webRequest blocking via "webRequestBlocking" + "webRequestFilterResponse" in MV2. In MV3, use declarativeNetRequest.'],
    ['declarativeNetRequest', 'Firefox supports declarativeNetRequest with some rule differences. Static rules work; dynamic rules have minor differences.'],
    ['offscreen', 'Firefox does not support the offscreen API. Background scripts may need adjustment.'],
  ]);

  // Chrome-only manifest keys to remove
  const UNSUPPORTED_MANIFEST_KEYS = new Set([
    'minimum_chrome_version',
    'update_url',
    'differential_fingerprint',
    'key',
    'nacl_modules',
    'platforms',
    'current_locale',
    'import',
    'export',
    'storage',
  ]);

  // Chrome APIs that are NOT available in Firefox
  const UNSUPPORTED_APIS = new Set([
    'chrome.debugger',
    'chrome.declarativeContent',
    'chrome.desktopCapture',
    'chrome.documentScan',
    'chrome.enterprise',
    'chrome.fileBrowserHandler',
    'chrome.fileSystemProvider',
    'chrome.fontSettings',
    'chrome.gcm',
    'chrome.identity',
    'chrome.instanceID',
    'chrome.loginState',
    'chrome.networking',
    'chrome.platformKeys',
    'chrome.power',
    'chrome.printing',
    'chrome.printingMetrics',
    'chrome.processes',
    'chrome.signedInDevices',
    'chrome.system.cpu',
    'chrome.system.memory',
    'chrome.tabGroups',
    'chrome.ttsEngine',
    'chrome.vpnProvider',
    'chrome.wallpaper',
  ]);

  /**
   * Generate a UUID v4-style addon ID for Firefox
   * @param {string} extensionId - Original Chrome extension ID
   * @returns {string} UUID-format addon ID
   */
  function generateGeckoId(extensionId) {
    // Create a deterministic ID based on the Chrome extension ID
    // so the same Chrome extension always gets the same Firefox ID
    const hash = simpleHash(extensionId);
    const hex = hash.toString(16).padStart(32, '0');
    return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}}`;
  }

  /**
   * Simple hash function for deterministic ID generation
   */
  function simpleHash(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    // Return as BigInt-like combined value
    return (Math.abs(h1) * 0x100000000 + Math.abs(h2));
  }

  /**
   * Convert a Chrome manifest to Firefox-compatible format
   * @param {Object} chromeManifest - Original Chrome manifest.json contents
   * @param {string} chromeExtensionId - Original Chrome extension ID
   * @returns {{ manifest: Object, report: Object }}
   */
  function convert(chromeManifest, chromeExtensionId) {
    const manifest = JSON.parse(JSON.stringify(chromeManifest)); // deep clone
    const report = {
      warnings: [],
      errors: [],
      removedKeys: [],
      modifiedKeys: [],
      unsupportedApis: [],
      compatible: true
    };

    // 1. Add browser_specific_settings.gecko
    if (!manifest.browser_specific_settings) {
      manifest.browser_specific_settings = {};
    }
    manifest.browser_specific_settings.gecko = {
      id: generateGeckoId(chromeExtensionId),
      strict_min_version: '128.0'
    };
    report.modifiedKeys.push('browser_specific_settings.gecko');

    // 2. Handle manifest_version
    if (manifest.manifest_version === 2) {
      report.warnings.push('Extension uses Manifest V2. Firefox supports MV2 but it is deprecated.');
    }

    // 3. Convert background configuration
    if (manifest.background) {
      convertBackground(manifest, report);
    }

    // 4. Handle permissions
    if (manifest.permissions) {
      convertPermissions(manifest, report);
    }
    if (manifest.optional_permissions) {
      convertOptionalPermissions(manifest, report);
    }

    // 5. Remove unsupported manifest keys
    for (const key of UNSUPPORTED_MANIFEST_KEYS) {
      if (manifest[key] !== undefined) {
        delete manifest[key];
        report.removedKeys.push(key);
      }
    }

    // 6. Handle content_security_policy differences
    if (manifest.content_security_policy) {
      convertCSP(manifest, report);
    }

    // 7. Handle web_accessible_resources format differences (MV3)
    if (manifest.manifest_version === 3 && manifest.web_accessible_resources) {
      convertWebAccessibleResources(manifest, report);
    }

    // 8. Handle options page
    if (manifest.options_page && !manifest.options_ui) {
      manifest.options_ui = {
        page: manifest.options_page,
        open_in_tab: true
      };
      delete manifest.options_page;
      report.modifiedKeys.push('options_page → options_ui');
    }

    // 9. Handle externally_connectable
    if (manifest.externally_connectable) {
      convertExternallyConnectable(manifest, report);
    }

    // 10. Determine overall compatibility
    if (report.errors.length > 0) {
      report.compatible = false;
    }

    return { manifest, report };
  }

  /**
   * Convert background script configuration
   */
  function convertBackground(manifest, report) {
    const bg = manifest.background;

    // MV3: Chrome uses service_worker, Firefox uses scripts array
    if (bg.service_worker) {
      manifest.background = {
        scripts: [bg.service_worker],
        type: bg.type || 'module'
      };
      report.modifiedKeys.push('background.service_worker → background.scripts');
      report.warnings.push(
        'Converted service_worker to background scripts. Firefox MV3 uses event pages (non-persistent background scripts) instead of service workers. ' +
        'Some Service Worker APIs (e.g., fetch event listeners, CacheStorage in SW context) may not work identically.'
      );
    }

    // MV2: Chrome uses "persistent": true by default, Firefox uses event pages
    if (bg.persistent === true) {
      bg.persistent = false;
      report.warnings.push('Set background.persistent to false (Firefox prefers event pages).');
      report.modifiedKeys.push('background.persistent');
    }
  }

  /**
   * Convert permissions array
   */
  function convertPermissions(manifest, report) {
    const filtered = [];
    for (const perm of manifest.permissions) {
      if (UNSUPPORTED_PERMISSIONS.has(perm)) {
        report.warnings.push(`Permission "${perm}" is not supported in Firefox and was removed.`);
        report.removedKeys.push(`permissions.${perm}`);
      } else if (PARTIAL_PERMISSIONS.has(perm)) {
        report.warnings.push(`Permission "${perm}": ${PARTIAL_PERMISSIONS.get(perm)}`);
        filtered.push(perm);
      } else {
        filtered.push(perm);
      }
    }
    manifest.permissions = filtered;

    // Move host permissions out of permissions array for MV3
    if (manifest.manifest_version === 3 && !manifest.host_permissions) {
      const hostPerms = manifest.permissions.filter(p => p.includes('://') || p === '<all_urls>');
      if (hostPerms.length > 0) {
        manifest.host_permissions = hostPerms;
        manifest.permissions = manifest.permissions.filter(p => !hostPerms.includes(p));
        report.modifiedKeys.push('Moved host patterns from permissions to host_permissions');
      }
    }
  }

  /**
   * Convert optional permissions
   */
  function convertOptionalPermissions(manifest, report) {
    manifest.optional_permissions = manifest.optional_permissions.filter(perm => {
      if (UNSUPPORTED_PERMISSIONS.has(perm)) {
        report.warnings.push(`Optional permission "${perm}" is not supported in Firefox.`);
        return false;
      }
      return true;
    });
  }

  /**
   * Convert content security policy
   */
  function convertCSP(manifest, report) {
    // In MV3, CSP is an object; in MV2, it's a string
    if (typeof manifest.content_security_policy === 'string') {
      // MV2 format - Firefox supports this
      return;
    }
    // MV3 format: { extension_pages: "...", sandbox: "..." }
    // Firefox supports the same format in MV3
  }

  /**
   * Convert web_accessible_resources (MV3 format)
   */
  function convertWebAccessibleResources(manifest, report) {
    if (Array.isArray(manifest.web_accessible_resources)) {
      for (const entry of manifest.web_accessible_resources) {
        if (entry.use_dynamic_url !== undefined) {
          delete entry.use_dynamic_url;
          report.warnings.push('Removed use_dynamic_url from web_accessible_resources (Firefox-unsupported).');
        }
        
        // Firefox expects UUIDs, email format, or "*" for extension_ids.
        // Chrome 32-char IDs are strictly rejected. Let's convert them to their Gecko equivalents.
        if (Array.isArray(entry.extension_ids)) {
          const originalIds = [...entry.extension_ids];
          entry.extension_ids = entry.extension_ids.map(id => {
            if (id === '*') return '*';
            // If it's a 32-character Chrome extension ID, convert it to our deterministic Firefox UUID
            if (typeof id === 'string' && id.length === 32) {
              return generateGeckoId(id);
            }
            // If it's already a valid Firefox format (e.g. email or UUID), keep it
            if (typeof id === 'string' && (id.includes('@') || id.includes('-'))) {
              return id;
            }
            // Fallback: allow all extensions to ensure it doesn't break
            return '*';
          });
          
          if (originalIds.join(',') !== entry.extension_ids.join(',')) {
            report.warnings.push('Converted Chrome extension IDs in web_accessible_resources to Firefox UUIDs.');
            report.modifiedKeys.push('web_accessible_resources.extension_ids');
          }
        }
      }
    }
  }

  /**
   * Convert externally_connectable
   */
  function convertExternallyConnectable(manifest, report) {
    const extConn = manifest.externally_connectable;
    let modified = false;

    // Remove accepts_tls_channel_id (not supported in Firefox)
    if (extConn.accepts_tls_channel_id !== undefined) {
      delete extConn.accepts_tls_channel_id;
      modified = true;
      report.warnings.push('Removed externally_connectable.accepts_tls_channel_id (Firefox-unsupported).');
    }

    // Convert Chrome IDs to Firefox Gecko IDs
    if (Array.isArray(extConn.ids)) {
      const originalIds = [...extConn.ids];
      extConn.ids = extConn.ids.map(id => {
        if (id === '*') return '*';
        if (typeof id === 'string' && id.length === 32) {
          return generateGeckoId(id);
        }
        if (typeof id === 'string' && (id.includes('@') || id.includes('-'))) {
          return id;
        }
        return '*';
      });

      if (originalIds.join(',') !== extConn.ids.join(',')) {
        modified = true;
        report.warnings.push('Converted Chrome extension IDs in externally_connectable.ids to Firefox UUIDs.');
      }
    }

    if (modified) {
      report.modifiedKeys.push('externally_connectable');
    }
  }

  /**
   * Scan extension source code for unsupported API usage
   * @param {Object} files - Map of filename → content (strings)
   * @returns {string[]} List of unsupported API calls found
   */
  function scanForUnsupportedApis(files) {
    const found = [];
    for (const [filename, content] of Object.entries(files)) {
      if (typeof content !== 'string') continue;
      for (const api of UNSUPPORTED_APIS) {
        // Match both chrome.xxx and browser.xxx variants
        const chromePattern = api.replace('chrome.', '');
        if (content.includes(`chrome.${chromePattern}`) || content.includes(`browser.${chromePattern}`)) {
          found.push(`${filename}: uses ${api}`);
        }
      }
    }
    return [...new Set(found)];
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.ManifestConverter = { convert, generateGeckoId, scanForUnsupportedApis };
  }

  return { convert, generateGeckoId, scanForUnsupportedApis };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ManifestConverter;
}
