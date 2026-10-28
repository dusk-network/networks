/* @ts-self-types="./format.d.ts" */
/**
 * How the apps write amounts, times and IDs, with Intl only. The locale and
 * the zone default to the browser's.
 *
 * @module
 */

import { keccak256 } from "./keccak.js";

const LUX_DECIMALS = 9;
const LUX_PER_DUSK = 10n ** BigInt(LUX_DECIMALS);

/** Decimals a short amount shows, when it's 0.01 DUSK or more. */
const SHORT_DECIMALS = 4;

/** 0.01 DUSK, in lux: under it, a short amount keeps 2 significant digits. */
const SMALL = 10_000_000n;

const ELLIPSIS = "…";
const MINUS = "−";

/**
 * @typedef {{ decimal: string, digits: string[], whole: Intl.NumberFormat }} LocaleParts
 */

/** @type {Map<string, LocaleParts>} */
const partsByLocale = new Map();

/**
 * How a locale writes a number: its decimal separator, its digits from 0 to
 * 9 and its grouping of whole numbers.
 *
 * @param {string | undefined} locale
 * @returns {LocaleParts}
 */
function localeParts(locale) {
  const key = locale ?? "";
  const known = partsByLocale.get(key);

  if (known) {
    return known;
  }

  const plain = new Intl.NumberFormat(locale, { useGrouping: false });
  const oneToZero = Array.from(plain.format(1234567890));
  const parts = {
    decimal:
      plain.formatToParts(1.5).find((part) => part.type === "decimal")?.value ??
      ".",
    digits: [oneToZero[9], ...oneToZero.slice(0, 9)],
    whole: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
  };

  partsByLocale.set(key, parts);

  return parts;
}

/**
 * @param {unknown} value
 * @returns {bigint}
 */
function luxOf(value) {
  if (typeof value === "bigint") return value;

  if (
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && /^\s*-?\d+\s*$/.test(value))
  ) {
    return BigInt(/** @type {number | string} */ (value));
  }

  throw new TypeError("An amount is a whole number of lux");
}

/**
 * Whole DUSK and the digits after the separator, in the locale's writing.
 *
 * @param {boolean} negative
 * @param {bigint} whole
 * @param {string} fraction Latin digits, trailing zeros trimmed
 * @param {string | undefined} locale
 */
function written(negative, whole, fraction, locale) {
  const { decimal, digits, whole: grouped } = localeParts(locale);
  const decimals = Array.from(fraction, (d) => digits[Number(d)]).join("");

  return `${negative ? MINUS : ""}${grouped.format(whole)}${decimals ? `${decimal}${decimals}` : ""}`;
}

/**
 * `lux` (not negative) to `decimals` decimals, rounded as `round` says.
 *
 * @param {bigint} lux
 * @param {number} decimals 0 to 9
 * @param {"down" | "up" | "nearest"} round
 * @returns {{ whole: bigint, fraction: string }}
 */
function rounded(lux, decimals, round) {
  const step = 10n ** BigInt(LUX_DECIMALS - decimals);
  const units =
    round === "down"
      ? lux / step
      : round === "up"
        ? (lux + step - 1n) / step
        : (lux + step / 2n) / step;
  const per = LUX_PER_DUSK / step;

  return {
    fraction:
      decimals === 0
        ? ""
        : (units % per).toString().padStart(decimals, "0").replace(/0+$/, ""),
    whole: units / per,
  };
}

/**
 * The decimals a short amount of `lux` (more than 0) shows: 4 from 0.01
 * DUSK, else as many as give 2 significant digits, up to all 9.
 *
 * @param {bigint} lux
 */
function shortDecimals(lux) {
  if (lux >= SMALL) {
    return SHORT_DECIMALS;
  }

  // A number of k digits in lux has its first significant digit at decimal
  // 10 − k, so its second at 11 − k.
  return Math.min(LUX_DECIMALS, 11 - lux.toString().length);
}

/**
 * `round` applies to the amount's size: down for balances and what can be
 * spent (never more than there is), up for fees (never less than is paid),
 * else to the nearest, half up.
 *
 * @param {bigint | number | string} lux
 * @param {{ mode?: "short" | "exact", round?: "down" | "up" | "nearest", locale?: string }} [options]
 * @returns {{ text: string, exact: string }}
 */
export function formatDusk(
  lux,
  { mode = "short", round = "nearest", locale } = {}
) {
  if (mode !== "short" && mode !== "exact") {
    throw new RangeError("The mode is short or exact");
  }

  if (round !== "down" && round !== "up" && round !== "nearest") {
    throw new RangeError("Rounding is down, up or nearest");
  }

  const value = luxOf(lux);
  const negative = value < 0n;
  const size = negative ? -value : value;
  const all = rounded(size, LUX_DECIMALS, "down");
  const exact = written(negative && size > 0n, all.whole, all.fraction, locale);

  if (mode === "exact" || size === 0n) {
    return { exact, text: exact };
  }

  const short = rounded(size, shortDecimals(size), round);

  return {
    exact,
    text: written(negative, short.whole, short.fraction, locale),
  };
}

/**
 * @param {bigint | number | string} lux
 * @returns {string}
 */
export function formatDuskPlain(lux) {
  const value = luxOf(lux);
  const size = value < 0n ? -value : value;
  const { fraction, whole } = rounded(size, LUX_DECIMALS, "down");

  return `${value < 0n ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * @param {Date | number | string} date
 * @returns {Date}
 */
function dateOf(date) {
  const at = date instanceof Date ? new Date(date.getTime()) : new Date(date);

  if (Number.isNaN(at.getTime())) {
    throw new RangeError("Not a date");
  }

  return at;
}

/** @type {Map<string, Intl.DateTimeFormat>} */
const dateFormats = new Map();

/**
 * @param {string | undefined} locale
 * @param {Intl.DateTimeFormatOptions} options
 */
function dateFormat(locale, options) {
  const key = `${locale ?? ""}\n${JSON.stringify(options)}`;
  let format = dateFormats.get(key);

  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(key, format);
  }

  return format;
}

/**
 * How the locale tells the time: its clock (12 or 24 hours) and its digits.
 *
 * @param {string | undefined} locale
 */
function clockOf(locale) {
  const resolved = dateFormat(locale, { hour: "numeric" }).resolvedOptions();
  const hourCycle = resolved.hourCycle ?? (resolved.hour12 ? "h12" : "h23");

  return { hourCycle, numberingSystem: resolved.numberingSystem };
}

/**
 * The zone's name at `at` as a locale gives it: "CET", "EST", or else a
 * "GMT+1" form.
 *
 * @param {string | undefined} locale
 * @param {string | undefined} timeZone
 * @param {Date} at
 */
function zoneName(locale, timeZone, at) {
  return (
    dateFormat(locale, { timeZone, timeZoneName: "short" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? ""
  );
}

/**
 * A short name for the zone, in letters, as English writes it where it can:
 * the locale's own when the locale is English, then British and American
 * English ("CET", "EST"), then a non-English locale's own letters where
 * English has none ("JST"); else a "GMT+9" form.
 *
 * @param {string | undefined} locale
 * @param {string | undefined} timeZone
 * @param {Date} at
 */
function zoneLabel(locale, timeZone, at) {
  const english = isEnglish(locale);
  const tried = english ? [locale, "en-GB", "en-US"] : ["en-GB", "en-US", locale];

  for (const each of tried) {
    const name = zoneName(each, timeZone, at);

    if (/^[A-Z]{2,5}$/.test(name)) {
      return name;
    }
  }

  return zoneName("en-GB", timeZone, at) || "GMT";
}

/**
 * Whether a locale (the browser's when none is given) is English.
 *
 * @param {string | undefined} locale
 */
const isEnglish = (locale) =>
  /^en(-|$)/i.test(dateFormat(locale, {}).resolvedOptions().locale);

/**
 * The calendar day of `at` in the zone, as a day count, for telling today
 * and yesterday apart.
 *
 * @param {string | undefined} timeZone
 * @param {Date} at
 */
function dayNumber(timeZone, at) {
  const parts = dateFormat("en-GB", {
    day: "numeric",
    month: "numeric",
    timeZone,
    year: "numeric",
  }).formatToParts(at);
  /** @param {string} type */
  const part = (type) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);

  return Date.UTC(part("year"), part("month") - 1, part("day")) / 86_400_000;
}

/**
 * @param {Date | number | string} date
 * @param {{
 *   seconds?: boolean,
 *   date?: "auto" | "full",
 *   locale?: string,
 *   timeZone?: string,
 *   now?: Date | number | string,
 * }} [options]
 * @returns {string}
 */
export function formatTime(
  date,
  { seconds = false, date: dateStyle = "auto", locale, timeZone, now } = {}
) {
  if (dateStyle !== "auto" && dateStyle !== "full") {
    throw new RangeError("The date is auto or full");
  }

  const at = dateOf(date);
  const { hourCycle, numberingSystem } = clockOf(locale);
  const clock = dateFormat(isEnglish(locale) ? locale : "en-US", {
    hour: hourCycle === "h23" || hourCycle === "h24" ? "2-digit" : "numeric",
    hourCycle,
    minute: "2-digit",
    numberingSystem,
    ...(seconds ? { second: "2-digit" } : {}),
    timeZone,
  }).format(at);
  const time = `${clock} ${zoneLabel(locale, timeZone, at)}`;

  if (dateStyle === "auto") {
    const today = dayNumber(timeZone, dateOf(now ?? Date.now()));
    const day = dayNumber(timeZone, at);

    if (day === today) return `Today, ${time}`;
    if (day === today - 1) return `Yesterday, ${time}`;

    const thisYear =
      dateFormat("en-GB", { timeZone, year: "numeric" }).format(at) ===
      dateFormat("en-GB", { timeZone, year: "numeric" }).format(
        dateOf(now ?? Date.now())
      );
    const words = dateFormat("en-GB", {
      day: "numeric",
      month: "short",
      numberingSystem,
      timeZone,
      ...(thisYear ? {} : { year: "numeric" }),
    }).format(at);

    return `${words}, ${time}`;
  }

  const words = dateFormat("en-GB", {
    day: "numeric",
    month: "short",
    numberingSystem,
    timeZone,
    weekday: "short",
    year: "numeric",
  })
    .format(at)
    .replace(",", "");

  return `${words}, ${time}`;
}

/**
 * The middle of `text` cut out, keeping `head` and `tail` characters, when
 * that makes it at least 3 characters shorter.
 *
 * @param {string} text
 * @param {number} head
 * @param {number} tail
 */
const middle = (text, head, tail) =>
  text.length > head + tail + 3
    ? `${text.slice(0, head)}${ELLIPSIS}${text.slice(-tail)}`
    : text;

/**
 * Without 0x, so it doesn't look like the EVM addresses beside it.
 *
 * @param {string} hex With or without 0x, in any case
 * @param {{ short?: boolean }} [options]
 * @returns {string}
 */
export function formatContractId(hex, { short = false } = {}) {
  const id = typeof hex === "string" ? hex.trim().toLowerCase().replace(/^0x/, "") : "";

  if (!/^[0-9a-f]{64}$/.test(id)) {
    throw new TypeError("A contract ID is 32 bytes in hex");
  }

  return short ? middle(id, 6, 6) : id;
}

/**
 * @param {string} account
 * @returns {string}
 */
export function shortAccount(account) {
  if (typeof account !== "string") {
    throw new TypeError("An account is a base58 string");
  }

  return middle(account.trim(), 6, 6);
}

/**
 * @param {string} address
 * @param {{ short?: boolean }} [options]
 * @returns {string}
 */
export function formatEvmAddress(address, { short = false } = {}) {
  const hex = typeof address === "string" ? address.trim() : "";

  if (!/^0x[0-9a-fA-F]{40}$/.test(hex)) {
    throw new TypeError("An EVM address is 0x and 20 bytes in hex");
  }

  const lower = hex.slice(2).toLowerCase();
  const hash = keccak256(new TextEncoder().encode(lower));
  const checksummed = Array.from(lower, (c, i) => {
    const nibble = (hash[i >> 1] >> (i % 2 === 0 ? 4 : 0)) & 0xf;

    return nibble >= 8 ? c.toUpperCase() : c;
  }).join("");
  const full = `0x${checksummed}`;

  return short ? middle(full, 6, 4) : full;
}
