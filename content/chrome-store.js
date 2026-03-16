/**
 * Chrome2Fox — Content Script for Chrome Web Store
 * Injects "Add to Firefox" button on extension detail pages.
 */

(function () {
  'use strict';

  const BUTTON_ID = 'chrome2fox-install-btn';
  const TOAST_ID = 'chrome2fox-toast';
  
  let currentExtensionId = null;
  let overlayContainer = null;
  let trackedNativeButton = null;
  let isTracking = false;
  let lastUrl = location.href;

  // Cache for extension metadata
  let cachedMeta = null;

  // ─── Extension Info ───

  function getExtensionId() {
    const match = location.href.match(/\/detail\/(?:[^/]+\/)?([a-z]{32})/i);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Extract extension name from URL slug
   * URL format: /detail/extension-name/extension-id
   */
  function getNameFromUrl() {
    const match = location.pathname.match(/\/detail\/([^/]+)/);
    if (match) {
      // Convert slug to readable name: "my-awesome-extension" -> "My Awesome Extension"
      return match[1]
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
    }
    return null;
  }

  /**
   * Get extension metadata with retries
   * Waits for SPA content to be ready
   */
  async function getExtensionMeta() {
    // Return cached if valid for current extension
    const extId = getExtensionId();
    if (cachedMeta && cachedMeta.extensionId === extId) {
      return cachedMeta;
    }

    const meta = {
      extensionId: extId,
      name: '',
      icon: '',
      version: ''
    };

    // Try multiple times with delays to wait for SPA content
    const delays = [0, 100, 300, 500, 1000, 2000];
    
    for (const delay of delays) {
      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }

      // Method 1: h1 element (most reliable when available)
      const h1 = document.querySelector('h1') || queryShadowDOM('h1');
      if (h1?.textContent?.trim()) {
        const h1Text = h1.textContent.trim();
        // Validate: not generic, not too short, not the store name
        if (h1Text.length > 2 && 
            !h1Text.toLowerCase().includes('chrome web store') &&
            !h1Text.toLowerCase().includes('extensions')) {
          meta.name = h1Text;
          console.log(`[Chrome2Fox] Name from h1 (delay ${delay}ms): "${meta.name}"`);
          break;
        }
      }

      // Method 2: Page title (after SPA has updated it)
      const title = document.title;
      const cleanTitle = title
        .replace(/\s*[-–]\s*Chrome Web Store.*$/i, '')
        .replace(/\s*[-–]\s*Google Chrome.*$/i, '')
        .trim();
      
      if (cleanTitle.length > 2 && 
          !cleanTitle.toLowerCase().includes('chrome web store')) {
        meta.name = cleanTitle;
        console.log(`[Chrome2Fox] Name from title (delay ${delay}ms): "${meta.name}"`);
        break;
      }
    }

    // Method 3: Fallback to URL slug
    if (!meta.name || meta.name.length < 2) {
      meta.name = getNameFromUrl() || 'Extension';
      console.log(`[Chrome2Fox] Name from URL slug: "${meta.name}"`);
    }

    // Get icon
    const imgs = queryAllShadowDOM('img');
    for (const img of imgs) {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w >= 64 && w <= 128 && h >= 64 && h <= 128 && 
          img.src?.includes('googleusercontent')) {
        meta.icon = img.src;
        break;
      }
    }

    // Cache result
    cachedMeta = meta;
    console.log('[Chrome2Fox] Final metadata:', meta);
    return meta;
  }

  // ─── Shadow DOM Helpers ───

  function queryShadowDOM(selector, root = document) {
    const el = root.querySelector(selector);
    if (el) return el;
    for (const child of root.querySelectorAll('*')) {
      if (child.shadowRoot) {
        const found = queryShadowDOM(selector, child.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  }

  function queryAllShadowDOM(selector, root = document, results = []) {
    results.push(...root.querySelectorAll(selector));
    for (const child of root.querySelectorAll('*')) {
      if (child.shadowRoot) {
        queryAllShadowDOM(selector, child.shadowRoot, results);
      }
    }
    return results;
  }

  /**
   * Find the install button
   */
  function findNativeButton() {
    const buttons = queryAllShadowDOM('button, [role="button"]');
    
    const installTexts = [
      'add to chrome', 'use on chrome', 'usar no chrome', 
      'adicionar ao chrome', 'instalar', 'get', 'obter'
    ];

    const candidates = [];

    for (const btn of buttons) {
      const text = (btn.textContent || '').toLowerCase();
      const rect = btn.getBoundingClientRect();

      if (rect.width < 80 || rect.height < 25) continue;
      if (rect.width === 0) continue;

      const isInstallBtn = installTexts.some(t => text.includes(t));
      if (!isInstallBtn) continue;

      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length > 2) continue;

      candidates.push({
        btn,
        text: text.trim().substring(0, 50),
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const aInHeader = a.top >= 80 && a.top <= 350 ? 1 : 0;
      const bInHeader = b.top >= 80 && b.top <= 350 ? 1 : 0;
      if (aInHeader !== bInHeader) return bInHeader - aInHeader;
      return (b.width * b.height) - (a.width * a.height);
    });

    return candidates[0]?.btn || null;
  }

  // ─── Overlay Button ───

  function createOverlayButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (existing?.parentElement) existing.parentElement.remove();

    overlayContainer = document.createElement('div');
    overlayContainer.id = 'chrome2fox-overlay-container';
    overlayContainer.style.cssText = `
      position: fixed;
      z-index: 9999999;
      display: none;
      align-items: center;
      justify-content: center;
    `;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.className = 'chrome2fox-injected-btn';
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 77.42 79.97" fill="none" style="vertical-align:middle; margin-right:8px;">
        <path d="M73.86,28.74c-3.2-7.3-9.07-13.43-16.1-17.08A34.39,34.39,0,0,0,38.71,8.4a34.72,34.72,0,0,0-24,12.51A33.59,33.59,0,0,0,8.4,38.71,34.82,34.82,0,0,0,38.71,73.57a34.19,34.19,0,0,0,20.07-6.44,33.87,33.87,0,0,0,12.45-17A34.78,34.78,0,0,0,73.86,28.74Z" fill="#FF9500"/>
        <circle cx="38.71" cy="38.71" r="16" fill="white"/>
      </svg>
      <span class="c2f-btn-text">Add to Firefox</span>
    `;

    btn.addEventListener('click', handleClick);
    overlayContainer.appendChild(btn);
    document.body.appendChild(overlayContainer);
    return btn;
  }

  function trackButton() {
    if (!isTracking) return;

    if (trackedNativeButton?.isConnected) {
      const rect = trackedNativeButton.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        overlayContainer.style.display = 'flex';
        overlayContainer.style.top = rect.top + 'px';
        overlayContainer.style.left = rect.left + 'px';
        overlayContainer.style.width = rect.width + 'px';
        overlayContainer.style.height = Math.max(rect.height, 40) + 'px';
      }
    }
    requestAnimationFrame(trackButton);
  }

  function showFloatingButton() {
    if (!overlayContainer) createOverlayButton();
    overlayContainer.style.display = 'flex';
    overlayContainer.style.cssText = `
      position: fixed;
      z-index: 9999999;
      display: flex;
      align-items: center;
      justify-content: center;
      top: 120px;
      right: 20px;
      width: auto;
      height: auto;
    `;
  }

  function checkInstallationStatus() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn || !currentExtensionId) return;

    browser.runtime.sendMessage({ action: 'checkInstallation', extensionId: currentExtensionId })
      .then(res => {
        const text = btn.querySelector('.c2f-btn-text');
        if (res?.installed) {
          text.textContent = 'Manage in Firefox';
          btn.classList.add('chrome2fox-installed');
        } else {
          text.textContent = 'Add to Firefox';
          btn.classList.remove('chrome2fox-installed');
        }
      }).catch(() => {});
  }

  // ─── Click Handler ───

  async function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const btn = document.getElementById(BUTTON_ID) || this;
    const extensionId = getExtensionId();
    if (!extensionId) {
      showToast('Could not get extension ID', 'error');
      return;
    }

    if (btn.classList.contains('chrome2fox-installed')) {
      navigator.clipboard.writeText('about:addons').catch(() => {});
      showToast('Go to about:addons to manage extensions.', 'info');
      return;
    }

    btn.disabled = true;
    const textEl = btn.querySelector('.c2f-btn-text');
    textEl.textContent = 'Converting...';
    btn.classList.add('chrome2fox-loading');
    showToast('Converting...', 'progress');

    // Get metadata with proper waiting
    const meta = await getExtensionMeta();

    try {
      const response = await browser.runtime.sendMessage({
        action: 'convertExtension',
        data: { extensionId, name: meta.name, icon: meta.icon }
      });

      if (response.success) {
        textEl.textContent = 'Converted ✓';
        btn.classList.remove('chrome2fox-loading');
        btn.classList.add('chrome2fox-success');
        showToast(`"${meta.name}" converted! Check downloads.`, 'success');
      } else {
        throw new Error(response.error);
      }
    } catch (err) {
      textEl.textContent = 'Add to Firefox';
      btn.disabled = false;
      btn.classList.remove('chrome2fox-loading');
      showToast(`Error: ${err.message}`, 'error');
    }
  }

  // ─── Toast ───

  function showToast(message, type = 'info') {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      document.body.appendChild(toast);
    }

    toast.className = `chrome2fox-toast chrome2fox-toast-${type}`;
    toast.innerHTML = `<div>${type === 'success' ? '✅' : type === 'error' ? '❌' : '🦊'} ${message}</div>`;
    toast.style.display = 'block';

    if (type !== 'progress') {
      setTimeout(() => { toast.style.display = 'none'; }, 5000);
    }
  }

  // ─── Progress Updates ───

  browser.runtime.onMessage.addListener((message) => {
    if (message.action === 'conversionUpdate' && message.data?.active) {
      const state = message.data.active;
      const toast = document.getElementById(TOAST_ID);
      if (toast && state.step) {
        toast.querySelector('div').textContent = `🦊 ${state.step.label} (${state.progress || 0}%)`;
      }
    }
  });

  // ─── SPA Navigation ───

  function resetState() {
    if (trackedNativeButton) {
      trackedNativeButton.style.opacity = '1';
      trackedNativeButton.style.pointerEvents = 'auto';
      trackedNativeButton = null;
    }
    currentExtensionId = null;
    isTracking = false;
    cachedMeta = null; // Clear cache on navigation
    if (overlayContainer) overlayContainer.style.display = 'none';
  }

  function initialize() {
    if (!location.pathname.includes('/detail/')) {
      resetState();
      return;
    }

    const extId = getExtensionId();
    if (!extId) return;

    if (currentExtensionId !== extId) {
      console.log('[Chrome2Fox] New extension:', extId);
      resetState();
      currentExtensionId = extId;
    }

    if (trackedNativeButton?.isConnected) return;

    const nativeBtn = findNativeButton();

    if (nativeBtn) {
      trackedNativeButton = nativeBtn;
      trackedNativeButton.style.opacity = '0';
      trackedNativeButton.style.pointerEvents = 'none';

      createOverlayButton();
      checkInstallationStatus();

      if (!isTracking) {
        isTracking = true;
        requestAnimationFrame(trackButton);
      }
    } else {
      showFloatingButton();
      checkInstallationStatus();
    }
  }

  // Patch History API
  const origPush = history.pushState;
  const origReplace = history.replaceState;

  history.pushState = function(...args) {
    origPush.apply(history, args);
    setTimeout(initialize, 100);
  };
  history.replaceState = function(...args) {
    origReplace.apply(history, args);
    setTimeout(initialize, 100);
  };
  window.addEventListener('popstate', () => setTimeout(initialize, 100));

  // URL polling backup
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      resetState();
      setTimeout(initialize, 200);
    }
  }, 500);

  // MutationObserver
  const observer = new MutationObserver(() => {
    if (location.pathname.includes('/detail/') && !trackedNativeButton) {
      initialize();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ─── Init ───

  console.log('[Chrome2Fox] Loading...');
  if (location.pathname.includes('/detail/')) {
    initialize();
    setTimeout(initialize, 500);
    setTimeout(initialize, 1500);
  }
})();
