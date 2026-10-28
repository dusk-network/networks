/**
 * Bytes as hex without 0x, and back.
 *
 * @module
 */

/** @param {string} hex */
export const fromHex = (hex) =>
  Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

/** @param {Uint8Array} bytes */
export const toHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
