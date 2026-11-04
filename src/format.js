/* @ts-self-types="./format.d.ts" */
/**
 * How the apps write times and IDs, with Intl only. The locale and the zone
 * default to the browser's. Amounts are in `@dusk-network/app-core/amounts`.
 *
 * @module
 */

import { keccak256 } from "./keccak.js";

const ELLIPSIS = "…";

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

/**
 * Rounded up on a scale that reads at a glance: to the minute up to 10
 * minutes, then to 5 minutes, to 10 minutes from an hour to 90 minutes, then
 * to hours, and from 48 hours to days.
 *
 * @param {number | bigint} seconds
 * @returns {string}
 */
export function aboutTime(seconds) {
  let minutes = Math.max(1, Math.ceil(Number(seconds) / 60));

  if (minutes > 10 && minutes < 60) {
    minutes = Math.ceil(minutes / 5) * 5;
  } else if (minutes > 60 && minutes <= 90) {
    minutes = Math.ceil(minutes / 10) * 10;
  }

  if (minutes < 60) {
    return `~${minutes} min`;
  }

  if (minutes === 60) {
    return "~1 hour";
  }

  if (minutes <= 90) {
    return `~${minutes} min`;
  }

  const hours = Math.round(minutes / 60);

  return hours < 48 ? `~${hours} hours` : `~${Math.round(minutes / 1_440)} days`;
}

/**
 * @param {number | bigint} seconds
 * @returns {string}
 */
export function aboutWords(seconds) {
  const text = aboutTime(seconds);
  const minutes = /^~(\d+) min$/u.exec(text);

  if (minutes) {
    return `about ${minutes[1]} minute${minutes[1] === "1" ? "" : "s"}`;
  }

  return text.replace(/^~/u, "about ");
}

/**
 * @param {number} n
 * @param {string} word
 */
const unit = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * @param {number | bigint} seconds
 * @returns {string}
 */
export function durationWords(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) / 60));

  if (total < 1) {
    return "less than a minute";
  }

  const days = Math.floor(total / 1_440);
  const hours = Math.floor((total % 1_440) / 60);
  const minutes = total % 60;

  if (days) {
    return hours ? `${unit(days, "day")} ${unit(hours, "hour")}` : unit(days, "day");
  }

  if (hours) {
    return minutes ? `${unit(hours, "hour")} ${unit(minutes, "minute")}` : unit(hours, "hour");
  }

  return unit(minutes, "minute");
}
