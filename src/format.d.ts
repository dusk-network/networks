/**
 * How the Dusk apps write amounts, times, durations and IDs, with Intl only.
 * The locale and the time zone default to the browser's.
 *
 * @example
 * ```js
 * import { aboutTime, durationWords, formatContractId, formatDusk, formatTime } from "@dusk/networks/format";
 *
 * formatDusk(1_853_542n, { round: "up" }); // { text: "0.0019", exact: "0.001853542" }
 * formatTime(Date.now(), { locale: "nl-NL", timeZone: "Europe/Amsterdam" }); // "Today, 14:05 CET"
 * formatContractId("0x93DE…", { short: true }); // "93de28…6ce1d4"
 * aboutTime(36_000); // "~10 hours": a route's usual time
 * durationWords(302_400); // "3 days 12 hours"
 * ```
 *
 * @module
 */

/**
 * An amount of DUSK from lux. `short` (the default): at most 4 decimals, but
 * 2 significant digits under 0.01, and never 0 for an amount that isn't;
 * `exact`: all 9, trailing zeros trimmed. Round `down` for balances, `up`
 * for fees. The locale's separators and digits; `exact` is always the whole
 * amount, for a title or a tap to reveal it.
 */
export declare function formatDusk(
  lux: bigint | number | string,
  options?: {
    mode?: "short" | "exact";
    round?: "down" | "up" | "nearest";
    locale?: string;
  }
): { text: string; exact: string };

/** Every decimal, a point and no grouping: for a file or an input's value. */
export declare function formatDuskPlain(lux: bigint | number | string): string;

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
