/**
 * How the Dusk apps write times, durations and IDs, with Intl only. The locale
 * and the time zone default to the browser's. Amounts are in
 * `@dusk/app-core/amounts`.
 *
 * @example
 * ```js
 * import { aboutTime, durationWords, formatContractId, formatTime } from "@dusk/networks/format";
 *
 * formatTime(Date.now(), { locale: "nl-NL", timeZone: "Europe/Amsterdam" }); // "Today, 14:05 CET"
 * formatContractId("0x93DE…", { short: true }); // "93de28…6ce1d4"
 * aboutTime(36_000); // "~10 hours": a route's usual time
 * durationWords(302_400); // "3 days 12 hours"
 * ```
 *
 * @module
 */

/**
 * "Today, 14:05 CET", "26 Oct, 09:12 CET", or with `date: "full"`, "Wed 28
 * Oct 2026, 14:05 CET": English words, the locale's clock and digits, and
 * seconds only when asked.
 */
export declare function formatTime(
  date: Date | number | string,
  options?: {
    seconds?: boolean;
    date?: "auto" | "full";
    locale?: string;
    timeZone?: string;
    now?: Date | number | string;
  }
): string;

/** A Dusk contract ID: lower-case hex without 0x; `short` keeps 6 characters at each end. */
export declare function formatContractId(hex: string, options?: { short?: boolean }): string;

/** A Dusk account with its middle cut out: 6 characters at each end. */
export declare function shortAccount(account: string): string;

/** An EVM address with its EIP-55 checksum; `short` keeps 0x and 4 characters, and the last 4. */
export declare function formatEvmAddress(address: string, options?: { short?: boolean }): `0x${string}`;

/**
 * A time as an estimate, rounded up on a scale that reads at a glance:
 * "~1 min", "~15 min", "~1 hour", "~70 min", "~10 hours", "~7 days".
 */
export declare function aboutTime(seconds: number | bigint): string;

/** `aboutTime` in words: "about 30 minutes", "about 1 hour", "about 7 days". */
export declare function aboutWords(seconds: number | bigint): string;

/**
 * A duration in words, to the minute and down: "7 days", "3 days 12
 * hours", "1 hour 30 minutes", "1 minute", "less than a minute".
 */
export declare function durationWords(seconds: number | bigint): string;
