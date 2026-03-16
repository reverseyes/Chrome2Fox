# 🦊 Chrome2Fox

> Install Chrome Web Store extensions directly on Firefox.

Chrome2Fox is a Firefox extension that allows you to download and convert Chrome extensions from the Chrome Web Store to work on Firefox.

## ⚠️ Important Disclaimer

> **Every extension CAN be downloaded and installed, but NOT every extension WILL work.**
>
> Chrome and Firefox have fundamental API differences. Chrome2Fox converts the manifest and injects polyfills, but some Chrome-specific features simply don't exist in Firefox. Extensions that rely heavily on `chrome.debugger`, `chrome.tabGroups`, `chrome.identity`, or Service Worker-specific APIs may not function properly.
>
> Always test converted extensions via `about:debugging` before relying on them.

## ✨ Features

- **One-click download** — Click "Add to Firefox" on any Chrome Web Store extension page
- **Automatic conversion** — Manifest V2/V3 conversion for Firefox compatibility
- **API polyfills** — Injects compatibility layer for Chrome-specific APIs
- **Progress tracking** — Real-time conversion progress with toast notifications
- **SPA support** — Works seamlessly with Chrome Web Store's single-page navigation

## 📦 Installation

### Requirements

- **Firefox Developer Edition** or **Firefox Nightly** (for unsigned extensions)
- Or configure `xpinstall.signatures.required` to `false` in `about:config`

### Steps

1. **Download the extension**
   - Clone this repo or download as ZIP
   ```bash
   git clone https://github.com/Neguiolidas/Chrome2Fox.git
   ```

2. **Load in Firefox**
   - Open `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select the `manifest.json` file from the extension folder

3. **Use it**
   - Navigate to the [Chrome Web Store](https://chromewebstore.google.com)
   - Browse any extension
   - Click the orange "Add to Firefox" button
   - The converted ZIP will download automatically

4. **Install converted extensions**
   - Go to `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select the downloaded ZIP file

## ⚠️ Firefox Limitations

Chrome extensions converted by Chrome2Fox may not work perfectly due to fundamental differences between browsers:

### Not Supported in Firefox

| Feature | Status |
|---------|--------|
| `chrome.debugger` | ❌ Not available |
| `chrome.identity` | ⚠️ Limited (use browser-native OAuth) |
| `chrome.tabGroups` | ❌ Firefox doesn't have tab groups API |
| `chrome.offscreen` | ❌ Not supported |
| `chrome.sidePanel` | ❌ Use `sidebar_action` instead |
| `chrome.processes` | ❌ Not available |
| `chrome.sessions` | ⚠️ Partial support |
| Service Workers | ⚠️ Converted to event pages |

### Manifest Differences

- **Manifest V2**: Fully supported (deprecated but works)
- **Manifest V3**: Partial support
  - `service_worker` → converted to `background.scripts`
  - Some MV3-specific features may not work

### API Polyfills Included

Chrome2Fox injects polyfills for common Chrome APIs:

- `chrome.runtime.lastError` — Error handling
- `chrome.storage.session` — In-memory fallback
- `chrome.action` / `chrome.browserAction` — Unified API
- `chrome.tabs.query` — Strips unsupported filters

### Best Practices

1. **Test before use** — Load temporarily via `about:debugging` first
2. **Check compatibility report** — Chrome2Fox shows which APIs are unsupported
3. **Use Developer Edition** — Unsigned extensions require non-release Firefox
4. **Report issues** — Some extensions may need manual adjustments

## 🔧 How It Works

```
Chrome Web Store
       ↓
[1] Download CRX from Google servers
       ↓
[2] Parse CRX → extract ZIP
       ↓
[3] Convert manifest.json (Chrome → Firefox)
       ↓
[4] Scan for unsupported APIs
       ↓
[5] Inject API polyfills
       ↓
[6] Build ZIP for Firefox
       ↓
[Download]
```

## 🛠️ Development

### Project Structure

```
Chrome2Fox/
├── manifest.json           # Firefox extension manifest
├── background/
│   └── service-worker.js   # Main conversion pipeline
├── content/
│   ├── chrome-store.js     # Content script for Web Store
│   └── chrome-store.css    # Button styling
├── lib/
│   ├── crx-downloader.js   # Download CRX from Google
│   ├── crx-parser.js       # Parse CRX format
│   ├── manifest-converter.js # Chrome → Firefox manifest
│   ├── api-polyfill.js     # Chrome API shims
│   └── jszip.min.js        # ZIP handling
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
└── icons/
```

### Testing

```bash
# Run tests
node tests/test-crx-parser.cjs
node tests/test-manifest-converter.cjs
```

## 📝 License

MIT License — Use freely, modify as needed.

## 🙏 Credits

Created by [Neguiolidas](https://github.com/Neguiolidas) for the Firefox community.

---

*Not affiliated with Google or Mozilla. Use at your own risk.*
