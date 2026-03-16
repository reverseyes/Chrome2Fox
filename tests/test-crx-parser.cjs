/**
 * Chrome2Fox — CRX Parser Test
 * Tests CRX3 and CRX2 parsing with mock binary data.
 */

// Load modules via require — they populate globalThis
require('../lib/crx-parser.js');
const CRXParser = globalThis.CRXParser;

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

// Helper: create mock CRX3 file
function createMockCRX3(zipContent) {
  const zipBytes = new Uint8Array(zipContent);
  const header = new Uint8Array([0x0A, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const buffer = new ArrayBuffer(12 + header.length + zipBytes.length);
  const view = new DataView(buffer);
  const arr = new Uint8Array(buffer);

  view.setUint32(0, 0x34327243, true);
  view.setUint32(4, 3, true);
  view.setUint32(8, header.length, true);
  arr.set(header, 12);
  arr.set(zipBytes, 12 + header.length);
  return buffer;
}

function createMockCRX2(zipContent) {
  const zipBytes = new Uint8Array(zipContent);
  const pubkey = new Uint8Array([1, 2, 3, 4]);
  const sig = new Uint8Array([5, 6, 7, 8, 9]);
  const buffer = new ArrayBuffer(16 + pubkey.length + sig.length + zipBytes.length);
  const view = new DataView(buffer);
  const arr = new Uint8Array(buffer);

  view.setUint32(0, 0x34327243, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, pubkey.length, true);
  view.setUint32(12, sig.length, true);
  arr.set(pubkey, 16);
  arr.set(sig, 16 + pubkey.length);
  arr.set(zipBytes, 16 + pubkey.length + sig.length);
  return buffer;
}

const fakeZip = [0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF];

console.log('\n🔧 CRX Parser Tests\n');

console.log('Test 1: Parse CRX3 format');
try {
  const crx3 = createMockCRX3(fakeZip);
  const result = CRXParser.parse(crx3);
  assert(result.version === 3, 'Version is 3');
  assert(result.zip instanceof ArrayBuffer, 'ZIP is ArrayBuffer');
  assert(result.zip.byteLength === fakeZip.length, `ZIP size matches (${result.zip.byteLength} == ${fakeZip.length})`);
  const arr = new Uint8Array(result.zip);
  assert(arr[0] === 0x50 && arr[1] === 0x4B, 'ZIP starts with PK magic');
} catch (e) {
  assert(false, `CRX3 parsing threw: ${e.message}`);
}

console.log('\nTest 2: Parse CRX2 format');
try {
  const crx2 = createMockCRX2(fakeZip);
  const result = CRXParser.parse(crx2);
  assert(result.version === 2, 'Version is 2');
  assert(result.zip instanceof ArrayBuffer, 'ZIP is ArrayBuffer');
  const arr = new Uint8Array(result.zip);
  assert(arr[0] === 0x50 && arr[1] === 0x4B, 'ZIP starts with PK magic');
} catch (e) {
  assert(false, `CRX2 parsing threw: ${e.message}`);
}

console.log('\nTest 3: Plain ZIP passthrough');
try {
  const zipBuffer = new Uint8Array(fakeZip).buffer;
  const result = CRXParser.parse(zipBuffer);
  assert(result.version === 0, 'Version is 0 (plain ZIP)');
  assert(result.headerLength === 0, 'No header');
} catch (e) {
  assert(false, `ZIP passthrough threw: ${e.message}`);
}

console.log('\nTest 4: Invalid magic number');
try {
  const badBuffer = new ArrayBuffer(20);
  const view = new DataView(badBuffer);
  view.setUint32(0, 0xDEADBEEF, true);
  CRXParser.parse(badBuffer);
  assert(false, 'Should have thrown for invalid magic');
} catch (e) {
  assert(e.message.includes('Invalid CRX magic'), `Correctly threw: ${e.message}`);
}

console.log('\nTest 5: Too-small file');
try {
  CRXParser.parse(new ArrayBuffer(4));
  assert(false, 'Should have thrown for small file');
} catch (e) {
  assert(e.message.includes('too small'), `Correctly threw: ${e.message}`);
}

console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(40)}\n`);
process.exit(failed > 0 ? 1 : 0);
