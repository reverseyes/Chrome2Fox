/**
 * CRX3 Parser Module
 * Parses Chrome Extension CRX3 binary format and extracts the ZIP payload.
 *
 * CRX3 Format:
 *   [4 bytes] Magic number: "Cr24" (0x43 0x72 0x32 0x34)
 *   [4 bytes] Version: 3 (uint32 LE)
 *   [4 bytes] Header length: N (uint32 LE)
 *   [N bytes] Header (protobuf-encoded CrxFileHeader with signatures)
 *   [M bytes] ZIP archive (the actual extension contents)
 */

const CRXParser = (() => {
  'use strict';

  const CRX_MAGIC_NUMBER = 0x34327243; // "Cr24" in little-endian
  const CRX_VERSION_2 = 2;
  const CRX_VERSION_3 = 3;

  /**
   * Parse a CRX binary and extract the ZIP payload
   * @param {ArrayBuffer} buffer - Raw CRX file bytes
   * @returns {{ zip: ArrayBuffer, version: number, headerLength: number }}
   * @throws {Error} if the format is invalid
   */
  function parse(buffer) {
    if (!buffer || buffer.byteLength < 4) {
      throw new Error('CRX file too small — must be at least 4 bytes');
    }

    const view = new DataView(buffer);

    // Check for plain ZIP first (PK\x03\x04) — before CRX size requirements
    if (buffer.byteLength >= 2 && view.getUint16(0, false) === 0x504B) {
      console.log('[CRXParser] File is already a plain ZIP (no CRX header)');
      return { zip: buffer, version: 0, headerLength: 0 };
    }

    // CRX format requires at least 16 bytes (magic + version + header length + some data)
    if (buffer.byteLength < 16) {
      throw new Error('CRX file too small — must be at least 16 bytes');
    }

    // 1. Validate magic number
    const magic = view.getUint32(0, true);
    if (magic !== CRX_MAGIC_NUMBER) {
      throw new Error(`Invalid CRX magic number: expected 0x${CRX_MAGIC_NUMBER.toString(16)}, got 0x${magic.toString(16)}`);
    }

    // 2. Read version
    const version = view.getUint32(4, true);

    if (version === CRX_VERSION_3) {
      return parseCRX3(buffer, view);
    } else if (version === CRX_VERSION_2) {
      return parseCRX2(buffer, view);
    } else {
      throw new Error(`Unsupported CRX version: ${version} (expected 2 or 3)`);
    }
  }

  /**
   * Parse CRX3 format
   */
  function parseCRX3(buffer, view) {
    // Bytes 8-11: header length
    const headerLength = view.getUint32(8, true);

    // ZIP starts after: magic(4) + version(4) + headerLen(4) + header(N)
    const zipOffset = 12 + headerLength;

    if (zipOffset >= buffer.byteLength) {
      throw new Error(`CRX3 header length (${headerLength}) exceeds file size (${buffer.byteLength})`);
    }

    const zipBuffer = buffer.slice(zipOffset);

    // Validate ZIP magic (PK\x03\x04)
    validateZipMagic(zipBuffer);

    console.log(`[CRXParser] CRX3 parsed: header=${headerLength}B, zip=${zipBuffer.byteLength}B`);

    return {
      zip: zipBuffer,
      version: 3,
      headerLength
    };
  }

  /**
   * Parse CRX2 format (legacy support)
   * CRX2:
   *   [4] magic, [4] version, [4] pubkey_len, [4] sig_len, [pubkey_len] pubkey, [sig_len] sig, [...] ZIP
   */
  function parseCRX2(buffer, view) {
    const pubkeyLen = view.getUint32(8, true);
    const sigLen = view.getUint32(12, true);

    const zipOffset = 16 + pubkeyLen + sigLen;

    if (zipOffset >= buffer.byteLength) {
      throw new Error(`CRX2 header exceeds file size`);
    }

    const zipBuffer = buffer.slice(zipOffset);
    validateZipMagic(zipBuffer);

    console.log(`[CRXParser] CRX2 parsed: pubkey=${pubkeyLen}B, sig=${sigLen}B, zip=${zipBuffer.byteLength}B`);

    return {
      zip: zipBuffer,
      version: 2,
      headerLength: pubkeyLen + sigLen + 4
    };
  }

  /**
   * Validate that a buffer starts with ZIP magic bytes
   */
  function validateZipMagic(buffer) {
    if (buffer.byteLength < 4) {
      throw new Error('ZIP payload too small');
    }
    const view = new DataView(buffer);
    const zipMagic = view.getUint16(0, false);
    if (zipMagic !== 0x504B) {
      throw new Error(`Expected ZIP magic (PK), got 0x${zipMagic.toString(16)}`);
    }
  }

  // Export for both browser extension and Node.js testing
  if (typeof globalThis !== 'undefined') {
    globalThis.CRXParser = { parse };
  }

  return { parse };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CRXParser;
}
