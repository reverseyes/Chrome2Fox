/**
 * Chrome2Fox — Popup Script
 * Manages the popup UI state, history display, and live conversion updates.
 */

(function () {
  'use strict';

  // ─── DOM Elements ───
  const activeSection = document.getElementById('active-conversion');
  const activeIcon = document.getElementById('active-icon');
  const activeName = document.getElementById('active-name');
  const activeStep = document.getElementById('active-step');
  const activeProgress = document.getElementById('active-progress');
  const activePct = document.getElementById('active-pct');
  const historyList = document.getElementById('history-list');
  const clearBtn = document.getElementById('btn-clear');
  const debuggingBtn = document.getElementById('btn-debugging');

  // ─── Init ───
  init();

  async function init() {
    // Load history
    await loadHistory();

    // Check active conversion
    try {
      const state = await browser.runtime.sendMessage({ action: 'getConversionState' });
      if (state?.active) {
        showActiveConversion(state.active);
      }
    } catch (e) {
      // Background script not ready
    }

    // Listen for live updates
    browser.runtime.onMessage.addListener(handleMessage);

    // Event listeners
    clearBtn.addEventListener('click', clearHistory);

    // about:debugging link (Firefox blocks opening about: pages via api)
    debuggingBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await navigator.clipboard.writeText('about:debugging#/runtime/this-firefox');
        const originalText = debuggingBtn.innerHTML;
        debuggingBtn.innerHTML = '📋 Copied to Clipboard!';
        setTimeout(() => {
          debuggingBtn.innerHTML = originalText;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy', err);
      }
    });
  }

  // ─── Message Handler ───
  function handleMessage(message) {
    if (message.action === 'conversionUpdate' && message.data) {
      if (message.data.active) {
        showActiveConversion(message.data.active);
      } else {
        hideActiveConversion();
        loadHistory(); // Refresh history after completion
      }
    }
  }

  // ─── Active Conversion Display ───
  function showActiveConversion(state) {
    activeSection.style.display = 'block';

    if (state.icon) {
      activeIcon.src = state.icon;
      activeIcon.style.display = 'block';
    } else {
      activeIcon.style.display = 'none';
    }

    activeName.textContent = state.name || 'Unknown Extension';
    activeStep.textContent = state.step?.label || 'Processing...';

    const pct = state.progress || 0;
    activeProgress.style.width = `${pct}%`;
    activePct.textContent = `${pct}%`;

    // Color changes for error
    if (state.step?.order === -1) {
      activeStep.style.color = '#E74C3C';
      activeStep.textContent = `Error: ${state.error || 'Unknown error'}`;
    } else if (state.step?.order === 9) {
      activeStep.style.color = '#2ECC71';
    } else {
      activeStep.style.color = '';
    }
  }

  function hideActiveConversion() {
    activeSection.style.display = 'none';
  }

  // ─── History ───
  async function loadHistory() {
    try {
      const history = await browser.runtime.sendMessage({ action: 'getHistory' });
      
      // Check installation status for history items
      const installedMap = {};
      if (history && history.length > 0) {
        await Promise.all(history.map(async (entry) => {
          if (!entry.error) {
            const res = await browser.runtime.sendMessage({ action: 'checkInstallation', extensionId: entry.extensionId });
            installedMap[entry.extensionId] = res?.installed || false;
          }
        }));
      }

      renderHistory(history || [], installedMap);
    } catch (e) {
      renderHistory([], {});
    }
  }

  function renderHistory(history, installedMap) {
    if (!history || history.length === 0) {
      historyList.innerHTML = `
        <div class="c2f-empty-state">
          <p>No conversions yet.</p>
          <p class="c2f-hint">Visit the Chrome Web Store and click<br>"Add to Firefox" on any extension!</p>
        </div>
      `;
      return;
    }

    historyList.innerHTML = history.map((entry, idx) => {
      const isError = !!entry.error;
      const statusEmoji = isError ? '❌' : '✅';
      const statusClass = isError ? 'error' : 'success';
      const date = formatDate(entry.convertedAt);
      const isInstalled = installedMap[entry.extensionId];
      
      const rawWarnings = entry.report?.warnings || [];
      const unsupportedApis = entry.report?.unsupportedApis || [];
      const totalWarnings = rawWarnings.length + unsupportedApis.length;

      let warningsHtml = '';
      if (totalWarnings > 0) {
        const lines = [
          ...rawWarnings.map(w => `• ${escapeHtml(w)}`),
          ...unsupportedApis.map(a => `• ⚠️ API needed: ${escapeHtml(a)}`)
        ].join('<br>');

        warningsHtml = `
          <details class="c2f-history-alerts">
            <summary>⚠️ ${totalWarnings} compatibility alert${totalWarnings > 1 ? 's' : ''}</summary>
            <div class="c2f-alerts-content">${lines}</div>
          </details>
        `;
      }

      return `
        <div class="c2f-history-item ${statusClass}" title="${isError ? escapeHtml(entry.error) : 'Converted successfully'}">
          <div class="c2f-history-item-header">
            ${entry.icon
              ? `<img class="c2f-history-icon" src="${escapeHtml(entry.icon)}" alt="" onerror="this.style.display='none'">`
              : '<div class="c2f-history-icon"></div>'
            }
            <div class="c2f-history-info">
              <div class="c2f-history-name">${escapeHtml(entry.name || entry.extensionId)}</div>
              <div class="c2f-history-date">${date}${entry.version ? ` · v${escapeHtml(entry.version)}` : ''}</div>
            </div>
            ${isInstalled 
              ? `<button class="c2f-uninstall-btn" data-id="${entry.extensionId}" title="Uninstall from Firefox">🗑️</button>`
              : `<div class="c2f-history-status">${statusEmoji}</div>`
            }
          </div>
          ${warningsHtml}
        </div>
      `;
    }).join('');

    // Add event listeners for uninstall buttons
    document.querySelectorAll('.c2f-uninstall-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const infoDiv = btn.parentElement.querySelector('.c2f-history-info');
        const originalHtml = infoDiv.innerHTML;
        
        btn.innerHTML = '📋';
        btn.style.opacity = '0.5';
        
        try {
          await navigator.clipboard.writeText('about:addons');
          infoDiv.innerHTML = '<div style="color:var(--c2f-accent);font-size:11px;line-height:1.2;">"about:addons" copied! Paste in a new tab to remove.</div>';
        } catch (err) {
          infoDiv.innerHTML = '<div style="color:var(--c2f-warning);font-size:11px;line-height:1.2;">Open "about:addons" manually to remove.</div>';
        }

        setTimeout(() => {
          infoDiv.innerHTML = originalHtml;
          btn.innerHTML = '🗑️';
          btn.style.opacity = '1';
        }, 4000);
      });
    });
  }

  async function clearHistory() {
    await browser.runtime.sendMessage({ action: 'clearHistory' });
    renderHistory([]);
  }

  // ─── Utilities ───
  function formatDate(isoString) {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diff = now - date;

      if (diff < 60000) return 'Just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
