/* @ts-self-types="./account.d.ts" */
/**
 * Dusk's public accounts: the base58 of a BLS12-381 public key, compressed,
 * and the raw form a contract takes that key in. Each is checked to be a
 * key, as Dusk checks one, so DUSK isn't sent to one that could never spend
 * it.
 *
 * @module
 */

import { COMPRESSED_BYTES, compress, decompress, fromRaw, toRaw } from "./bls.js";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DIGITS = new Map(Array.from(ALPHABET, (character, digit) => [character, BigInt(digit)]));

/**
 * @param {Uint8Array | ArrayLike<number>} bytes
 * @returns {string}
 */
export function encodeBase58(bytes) {
  const input = Array.from(/** @type {ArrayLike<number>} */ (bytes ?? []));

  if (!input.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw new TypeError("Base58 encodes bytes");
  }

  let number = input.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
  let out = "";

  while (number > 0n) {
    out = ALPHABET[Number(number % 58n)] + out;
    number /= 58n;
  }

  let zeros = 0;

  while (zeros < input.length && input[zeros] === 0) zeros += 1;

  return "1".repeat(zeros) + out;
}

/**
 * @param {string} text
 * @returns {Uint8Array | null}
 */
export function decodeBase58(text) {
  const value = typeof text === "string" ? text.trim() : "";

  if (!value) {
    return null;
  }

  let number = 0n;

  for (const character of value) {
    const digit = DIGITS.get(character);

    if (digit === undefined) return null;
    number = number * 58n + digit;
  }

  /** @type {number[]} */
  const bytes = [];

  while (number > 0n) {
    bytes.push(Number(number & 0xffn));
    number >>= 8n;
  }

  let zeros = 0;

  while (value[zeros] === "1") zeros += 1;

  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes.reverse()]);
}

/**
 * The key an account is, or null.
 *
 * @param {unknown} account
 */
function keyOf(account) {
  const bytes = typeof account === "string" ? decodeBase58(account) : null;

  return bytes?.length === COMPRESSED_BYTES ? decompress(bytes) : null;
}

/**
 * @param {unknown} account
 * @returns {boolean}
 */
export const isAccount = (account) => keyOf(account) !== null;

/**
 * @param {string} account
 * @returns {Uint8Array | null}
 */
export function accountToRawKey(account) {
  const key = keyOf(account);

  return key ? toRaw(key) : null;
}

/**
 * @param {Uint8Array} raw
 * @returns {string | null}
 */
export function rawKeyToAccount(raw) {
  const key = fromRaw(raw);

  return key ? encodeBase58(compress(key)) : null;
}
