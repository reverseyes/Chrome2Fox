/**
 * Chrome2Fox — Manifest Converter Test
 */

require('../lib/manifest-converter.js');
const ManifestConverter = globalThis.ManifestConverter;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

console.log('\n🔧 Manifest Converter Tests\n');

console.log('Test 1: Basic MV3 manifest conversion');
{
  const chrome = {
    manifest_version: 3,
    name: 'Test Extension',
    version: '1.0',
    description: 'A test extension',
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['storage', 'tabs'],
    action: { default_popup: 'popup.html' }
  };

  const { manifest, report } = ManifestConverter.convert(chrome, 'abcdefghijklmnopqrstuvwxyzabcdef');

  assert(manifest.browser_specific_settings?.gecko?.id, 'Has Gecko ID');
  assert(manifest.browser_specific_settings.gecko.strict_min_version === '128.0', 'Has strict_min_version');
  assert(manifest.background.scripts?.includes('background.js'), 'service_worker converted to scripts');
  assert(!manifest.background.service_worker, 'service_worker key removed');
  assert(manifest.permissions.includes('storage'), 'Kept storage permission');
  assert(manifest.permissions.includes('tabs'), 'Kept tabs permission');
  assert(report.warnings.length > 0, 'Has warnings about service_worker conversion');
  assert(report.compatible === true, 'Marked as compatible');
}

console.log('\nTest 2: Unsupported permissions removal');
{
  const chrome = {
    manifest_version: 3, name: 'Test', version: '1.0',
    permissions: ['storage', 'debugger', 'tabGroups', 'identity', 'tabs']
  };

  const { manifest, report } = ManifestConverter.convert(chrome, 'abcdefghijklmnopqrstuvwxyzabcdef');

  assert(!manifest.permissions.includes('debugger'), 'Removed debugger');
  assert(!manifest.permissions.includes('tabGroups'), 'Removed tabGroups');
  assert(!manifest.permissions.includes('identity'), 'Removed identity');
  assert(manifest.permissions.includes('storage'), 'Kept storage');
  assert(manifest.permissions.includes('tabs'), 'Kept tabs');
}

console.log('\nTest 3: MV2 background scripts');
{
  const chrome = {
    manifest_version: 2, name: 'MV2 Extension', version: '1.0',
    background: { scripts: ['bg.js'], persistent: true },
    permissions: ['<all_urls>', 'storage']
  };

  const { manifest, report } = ManifestConverter.convert(chrome, 'abcdefghijklmnopqrstuvwxyzabcdef');

  assert(manifest.background.scripts?.includes('bg.js'), 'Kept background scripts');
  assert(manifest.background.persistent === false, 'Set persistent to false');
  assert(report.warnings.some(w => w.includes('MV2') || w.includes('Manifest V2')), 'Warned about MV2');
}

console.log('\nTest 4: Remove unsupported manifest keys');
{
  const chrome = {
    manifest_version: 3, name: 'Test', version: '1.0',
    minimum_chrome_version: '100', update_url: 'https://example.com/update',
    key: 'MIIBIjANBgkqhk...', differential_fingerprint: 'abc123',
    permissions: []
  };

  const { manifest, report } = ManifestConverter.convert(chrome, 'abcdefghijklmnopqrstuvwxyzabcdef');

  assert(!manifest.minimum_chrome_version, 'Removed minimum_chrome_version');
  assert(!manifest.update_url, 'Removed update_url');
  assert(!manifest.key, 'Removed key');
  assert(!manifest.differential_fingerprint, 'Removed differential_fingerprint');
}

console.log('\nTest 5: Deterministic Gecko ID generation');
{
  const id1 = ManifestConverter.generateGeckoId('abcdefghijklmnopqrstuvwxyzabcdef');
  const id2 = ManifestConverter.generateGeckoId('abcdefghijklmnopqrstuvwxyzabcdef');
  const id3 = ManifestConverter.generateGeckoId('zyxwvutsrqponmlkjihgfedcbazyxwvu');

  assert(id1 === id2, 'Same Chrome ID produces same Gecko ID');
  assert(id1 !== id3, 'Different Chrome IDs produce different Gecko IDs');
  assert(id1.startsWith('{') && id1.endsWith('}'), 'ID is UUID format with braces');
}

console.log('\nTest 6: options_page → options_ui conversion');
{
  const chrome = {
    manifest_version: 3, name: 'Test', version: '1.0',
    options_page: 'options.html', permissions: []
  };

  const { manifest } = ManifestConverter.convert(chrome, 'abcdefghijklmnopqrstuvwxyzabcdef');

  assert(!manifest.options_page, 'Removed options_page');
  assert(manifest.options_ui?.page === 'options.html', 'Created options_ui.page');
  assert(manifest.options_ui?.open_in_tab === true, 'Set open_in_tab to true');
}

console.log('\nTest 7: Unsupported API scanning');
{
  const files = {
    'background.js': 'chrome.debugger.attach(target, "1.3"); chrome.storage.local.get("key");',
    'content.js': 'chrome.tabGroups.query({}); chrome.tabs.query({});',
    'popup.js': 'chrome.identity.getAuthToken({interactive: true});'
  };

  const unsupported = ManifestConverter.scanForUnsupportedApis(files);
  assert(unsupported.some(s => s.includes('debugger')), 'Found chrome.debugger usage');
  assert(unsupported.some(s => s.includes('tabGroups')), 'Found chrome.tabGroups usage');
  assert(unsupported.some(s => s.includes('identity')), 'Found chrome.identity usage');
  assert(!unsupported.some(s => s.includes('storage')), 'Did not flag chrome.storage (supported)');
}

console.log('\nTest 8: Host permissions separation');
{
  const chrome = {
    manifest_version: 3, name: 'Test', version: '1.0',
    permissions: ['storage', 'https://*.google.com/*', '<all_urls>']
  };

  const { manifest } = ManifestConverter.convert(chrome, 'abcdefghijklmnopqrstuvwxyzabcdef');

  assert(manifest.permissions.includes('storage'), 'Kept storage in permissions');
  assert(!manifest.permissions.includes('https://*.google.com/*'), 'Moved host pattern out');
  assert(manifest.host_permissions?.includes('https://*.google.com/*'), 'Host pattern in host_permissions');
  assert(manifest.host_permissions?.includes('<all_urls>'), '<all_urls> in host_permissions');
}

console.log('\nTest 9: web_accessible_resources extension_ids conversion');
{
  const chrome = {
    manifest_version: 3, name: 'Test', version: '1.0',
    web_accessible_resources: [
      {
        resources: ['image.png'],
        matches: ['<all_urls>'],
        extension_ids: ['ekcgkejcjdcmonfpmnljobemcbpnkamh', '*']
      }
    ]
  };

  const { manifest, report } = ManifestConverter.convert(chrome, 'abcdefghijklmnopqrstuvwxyzabcdef');

  const extIds = manifest.web_accessible_resources[0].extension_ids;
  assert(extIds.length === 2, 'Maintained extension_ids length');
  assert(extIds.includes('*'), 'Maintained wildcard ID');
  assert(extIds.some(id => id.startsWith('{') && id.endsWith('}')), 'Converted Chrome ID to Gecko UUID');
  assert(report.warnings.some(w => w.includes('web_accessible_resources')), 'Warned about web_accessible_resources conversion');
}

console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(40)}\n`);
process.exit(failed > 0 ? 1 : 0);
