/**
 * CRX Downloader Module
 * Downloads Chrome extensions from Google's update server.
 */

const CRXDownloader = (() => {
  'use strict';

  // Google's CRX update/download endpoint
  const CRX_DOWNLOAD_BASE = 'https://clients2.google.com/service/update2/crx';

  // Chrome version to spoof (needs to be recent enough for MV3 extensions)
  const CHROME_VERSION = '131.0.6778.86';

  /**
   * Build the CRX download URL for a given extension ID
   * @param {string} extensionId - Chrome Web Store extension ID
   * @returns {string} Direct CRX download URL
   */
  function buildDownloadUrl(extensionId) {
    const params = new URLSearchParams({
      response: 'redirect',
      prodversion: CHROME_VERSION,
      acceptformat: 'crx2,crx3',
      x: `id=${extensionId}&installsource=ondemand&uc`
    });
    return `${CRX_DOWNLOAD_BASE}?${params.toString()}`;
  }

  /**
   * Download a Chrome extension CRX file
   * @param {string} extensionId - Chrome Web Store extension ID
   * @param {function} [onProgress] - Progress callback (percent: number)
   * @returns {Promise<ArrayBuffer>} Raw CRX binary
   */
  async function download(extensionId, onProgress) {
    if (!extensionId || !/^[a-z]{32}$/i.test(extensionId)) {
      throw new Error(`Invalid extension ID: "${extensionId}" — must be 32 lowercase letters`);
    }

    const url = buildDownloadUrl(extensionId);
    console.log(`[CRXDownloader] Downloading: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/x-chrome-extension',
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Extension not found: ${extensionId}`);
        }
        if (response.status === 204) {
          throw new Error(`Extension unavailable or region-restricted: ${extensionId}`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check content type
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('chrome-extension') &&
          !contentType.includes('octet-stream') &&
          !contentType.includes('zip') &&
          !contentType.includes('crx')) {
        console.warn(`[CRXDownloader] Unexpected content-type: ${contentType}`);
      }

      // Download with progress tracking if possible
      if (onProgress && response.body && response.headers.get('content-length')) {
        return await downloadWithProgress(response, onProgress);
      }

      const buffer = await response.arrayBuffer();
      console.log(`[CRXDownloader] Downloaded ${buffer.byteLength} bytes`);

      if (buffer.byteLength < 100) {
        throw new Error('Downloaded file too small — possibly an error page');
      }

      return buffer;

    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error(`Network error downloading extension. Check your internet connection and CORS permissions.`);
      }
      throw err;
    }
  }

  /**
   * Download with progress tracking using ReadableStream
   */
  async function downloadWithProgress(response, onProgress) {
    const contentLength = parseInt(response.headers.get('content-length'), 10);
    const reader = response.body.getReader();
    const chunks = [];
    let receivedLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      receivedLength += value.length;

      const percent = Math.round((receivedLength / contentLength) * 100);
      onProgress(percent);
    }

    // Combine chunks into single ArrayBuffer
    const combined = new Uint8Array(receivedLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    console.log(`[CRXDownloader] Downloaded ${receivedLength} bytes (100%)`);
    return combined.buffer;
  }

  /**
   * Extract extension ID from a Chrome Web Store URL
   * @param {string} url - Chrome Web Store URL
   * @returns {string|null} Extension ID or null
   */
  function extractIdFromUrl(url) {
    // Formats:
    // https://chromewebstore.google.com/detail/name/EXTENSION_ID
    // https://chromewebstore.google.com/detail/EXTENSION_ID
    // https://chrome.google.com/webstore/detail/name/EXTENSION_ID
    const patterns = [
      /chromewebstore\.google\.com\/detail\/[^/]*\/([a-z]{32})/i,
      /chromewebstore\.google\.com\/detail\/([a-z]{32})/i,
      /chrome\.google\.com\/webstore\/detail\/[^/]*\/([a-z]{32})/i,
      /chrome\.google\.com\/webstore\/detail\/([a-z]{32})/i,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1].toLowerCase();
    }
    return null;
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.CRXDownloader = { download, buildDownloadUrl, extractIdFromUrl };
  }

  return { download, buildDownloadUrl, extractIdFromUrl };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CRXDownloader;
}
