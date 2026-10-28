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
