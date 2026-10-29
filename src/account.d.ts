/**
 * Dusk's public accounts: the base58 of a BLS12-381 public key, compressed,
 * and the raw form a contract takes that key in, as `PublicKey::to_raw_bytes`
 * gives it. Each is checked to be a key as Dusk checks one: a point of the
 * curve's prime-order subgroup, not the identity. DUSK sent to anything else
 * could never be spent.
 *
 * @example
 * ```js
 * import { accountToRawKey, isAccount, rawKeyToAccount } from "@dusk/networks/account";
 *
 * isAccount(input); // false for a typo: the key is checked, not just the length
 * const raw = accountToRawKey(account); // 193 bytes, or null
 * Uint8Array.of(1, ...raw); // `Account::External` as Sozu's stDUSK `balance_of` takes it
 * rawKeyToAccount(raw) === account; // true
 * ```
 *
 * @module
 */

/** Bytes as base58, in Dusk's alphabet (Bitcoin's), a "1" for each leading zero byte. Throws a TypeError for anything but bytes. */
export declare function encodeBase58(bytes: Uint8Array | ArrayLike<number>): string;

/** The bytes a base58 string stands for, trimmed first; null when it's empty or not base58. */
export declare function decodeBase58(text: string): Uint8Array | null;

/** Whether `account` is a Dusk public account: base58 of a compressed key, 96 bytes, that is a key. */
export declare function isAccount(account: unknown): boolean;

/**
 * An account's key in the raw form contracts take: x.c0, x.c1, y.c0 and
 * y.c1 in Montgomery form, each as six little-endian u64 limbs, then the
 * identity flag, 0. 193 bytes; null when `account` isn't an account.
 */
export declare function accountToRawKey(account: string): Uint8Array | null;

/** The account a raw key is, in base58; null when the bytes aren't a key's raw form. */
export declare function rawKeyToAccount(raw: Uint8Array): string | null;
