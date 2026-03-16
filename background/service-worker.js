/**
 * Chrome2Fox — Background Service Worker
 * Orchestrates the CRX → XPI conversion pipeline.
 */

(function () {
  'use strict';

  // ─── State ───
  const conversionState = {
    active: null, // { id, name, step, progress, error }
    history: []   // persisted in storage.local
  };

  // Pipeline steps for progress reporting
  const STEPS = {
    DOWNLOADING: { label: 'Downloading CRX...', order: 1 },
    PARSING: { label: 'Parsing CRX format...', order: 2 },
    EXTRACTING: { label: 'Extracting files...', order: 3 },
    CONVERTING: { label: 'Converting manifest...', order: 4 },
    SCANNING: { label: 'Scanning API compatibility...', order: 5 },
    POLYFILLING: { label: 'Injecting polyfill layer...', order: 6 },
    BUILDING: { label: 'Building XPI package...', order: 7 },
    INSTALLING: { label: 'Triggering install...', order: 8 },
    DONE: { label: 'Complete!', order: 9 },
    ERROR: { label: 'Error', order: -1 }
  };

  // ─── Message Handling ───
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'convertExtension') {
      handleConversion(message.data, sender.tab?.id)
        .then(result => sendResponse({ success: true, data: result }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true; // async response
    }

    if (message.action === 'getConversionState') {
      sendResponse({
        active: conversionState.active,
        history: conversionState.history
      });
      return false;
    }

    if (message.action === 'getHistory') {
      loadHistory().then(h => sendResponse(h));
      return true;
    }

    if (message.action === 'clearHistory') {
      browser.storage.local.set({ chrome2fox_history: [] });
      conversionState.history = [];
      sendResponse({ success: true });
      return false;
    }

    if (message.action === 'checkInstallation') {
      const geckoId = ManifestConverter.generateGeckoId(message.extensionId);
      browser.management.get(geckoId)
        .then(extInfo => sendResponse({ installed: true, extension: extInfo }))
        .catch(() => sendResponse({ installed: false }));
      return true;
    }

    if (message.action === 'uninstallExtension') {
      const geckoId = ManifestConverter.generateGeckoId(message.extensionId);
      browser.management.uninstall(geckoId, { showConfirmDialog: true })
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });

  // ─── Conversion Pipeline ───
  async function handleConversion(data, tabId) {
    const { extensionId, name, icon, version } = data;

    conversionState.active = {
      id: extensionId,
      name: name || extensionId,
      icon: icon || '',
      step: STEPS.DOWNLOADING,
      progress: 0,
      error: null,
      startTime: Date.now()
    };

    broadcastState(tabId);

    try {
      // Step 1: Download CRX
      updateStep(STEPS.DOWNLOADING, tabId);
      const crxBuffer = await CRXDownloader.download(extensionId, (pct) => {
        conversionState.active.progress = pct;
        broadcastState(tabId);
      });

      // Step 2: Parse CRX → extract ZIP
      updateStep(STEPS.PARSING, tabId);
      const { zip: zipBuffer } = CRXParser.parse(crxBuffer);

      // Step 3: Extract ZIP with JSZip
      updateStep(STEPS.EXTRACTING, tabId);
      const zip = await JSZip.loadAsync(zipBuffer);

      // Step 4: Read and convert manifest
      updateStep(STEPS.CONVERTING, tabId);
      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) {
        throw new Error('No manifest.json found in extension package');
      }
      const manifestText = await manifestFile.async('string');
      const chromeManifest = JSON.parse(manifestText);
      const { manifest: firefoxManifest, report } = ManifestConverter.convert(chromeManifest, extensionId);

      // Step 5: Scan source files for unsupported APIs
      updateStep(STEPS.SCANNING, tabId);
      const jsFiles = {};
      const fileEntries = Object.entries(zip.files);
      for (const [path, file] of fileEntries) {
        if (path.endsWith('.js') && !file.dir) {
          try {
            jsFiles[path] = await file.async('string');
          } catch (e) {
            // Skip binary/unreadable files
          }
        }
      }
      const unsupportedApis = ManifestConverter.scanForUnsupportedApis(jsFiles);
      report.unsupportedApis = unsupportedApis;

      // Step 6: Inject polyfill
      updateStep(STEPS.POLYFILLING, tabId);
      const polyfillSource = APIPolyfill.generatePolyfillSource();
      const polyfillFilename = APIPolyfill.getPolyfillFilename();
      zip.file(polyfillFilename, polyfillSource);

      // Add polyfill to all content scripts in manifest
      if (firefoxManifest.content_scripts) {
        for (const cs of firefoxManifest.content_scripts) {
          if (cs.js) {
            cs.js.unshift(polyfillFilename);
          }
        }
      }

      // Add polyfill to background scripts
      if (firefoxManifest.background && firefoxManifest.background.scripts) {
        firefoxManifest.background.scripts.unshift(polyfillFilename);
      }

      // Update manifest in ZIP
      zip.file('manifest.json', JSON.stringify(firefoxManifest, null, 2));

      // Step 7: Build ZIP
      updateStep(STEPS.BUILDING, tabId);
      const zipBlob = await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/zip',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      // Step 8: Trigger download
      updateStep(STEPS.INSTALLING, tabId);

      const zipUrl = URL.createObjectURL(zipBlob);
      const safeName = (name || extensionId)
        .replace(/[^a-zA-Z0-9_\-\s]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 50);

      // Download the ZIP — standard Firefox rejects unsigned XPI files as "corrupt"
      const downloadId = await browser.downloads.download({
        url: zipUrl,
        filename: `chrome2fox/${safeName}.zip`,
        saveAs: false
      });

      // Done!
      updateStep(STEPS.DONE, tabId);

      const result = {
        extensionId,
        name: name || extensionId,
        icon,
        version: chromeManifest.version || version || 'unknown',
        convertedAt: new Date().toISOString(),
        report,
        downloadId
      };

      // Save to history
      await saveToHistory(result);

      // Show notification
      browser.notifications.create(`chrome2fox-${extensionId}`, {
        type: 'basic',
        iconUrl: icon || browser.runtime.getURL('icons/icon-128.png'),
        title: 'Chrome2Fox — Extension Converted!',
        message: `"${safeName}" has been converted to a ZIP. Load it manually via about:debugging to test it.`
      });

      // Cleanup: Wait 2 minutes before revoking the blob URL to ensure Firefox
      // has completely finished writing the file to disk (prevents "corrupted file" errors).
      setTimeout(() => {
        URL.revokeObjectURL(zipUrl);
        conversionState.active = null;
        broadcastState(tabId);
      }, 120000);

      return result;

    } catch (err) {
      console.error('[Chrome2Fox] Conversion error:', err);
      conversionState.active.step = STEPS.ERROR;
      conversionState.active.error = err.message;
      broadcastState(tabId);

      // Save failed attempt
      await saveToHistory({
        extensionId,
        name: name || extensionId,
        icon,
        convertedAt: new Date().toISOString(),
        error: err.message,
        report: null
      });

      setTimeout(() => {
        conversionState.active = null;
      }, 5000);

      throw err;
    }
  }

  // ─── Helpers ───
  function updateStep(step, tabId) {
    if (conversionState.active) {
      conversionState.active.step = step;
      conversionState.active.progress = Math.round((step.order / 9) * 100);
    }
    broadcastState(tabId);
  }

  function broadcastState(tabId) {
    const state = {
      active: conversionState.active,
    };

    // Send to content script tab
    if (tabId) {
      browser.tabs.sendMessage(tabId, {
        action: 'conversionUpdate',
        data: state
      }).catch(() => { /* tab might be closed */ });
    }

    // Send to popup (if open)
    browser.runtime.sendMessage({
      action: 'conversionUpdate',
      data: state
    }).catch(() => { /* popup not open */ });
  }

  async function loadHistory() {
    try {
      const result = await browser.storage.local.get('chrome2fox_history');
      conversionState.history = result.chrome2fox_history || [];
      return conversionState.history;
    } catch {
      return [];
    }
  }

  async function saveToHistory(entry) {
    const history = await loadHistory();
    history.unshift(entry);
    // Keep last 50 entries
    if (history.length > 50) history.length = 50;
    conversionState.history = history;
    await browser.storage.local.set({ chrome2fox_history: history });
  }

  // Init: load history
  loadHistory();

  console.log('[Chrome2Fox] Background service worker initialized');
})();
