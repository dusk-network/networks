import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aboutTime,
  aboutWords,
  durationWords,
  formatContractId,
  formatDusk,
  formatDuskPlain,
  formatEvmAddress,
  formatTime,
  shortAccount,
} from "../src/format.js";
import { keccak256 } from "../src/keccak.js";

/** ICU builds differ in the space they put before AM: compare the words. */
const spaced = (/** @type {string} */ text) => text.replace(/[  ]/g, " ");

describe("amounts", () => {
  it("shows at most 4 decimals, and 2 significant digits under 0.01", () => {
    assert.deepEqual(formatDusk(1_853_542n, { locale: "en" }), { exact: "0.001853542", text: "0.0019" });

    for (const [lux, text] of [
      [173_852_610_026n, "173.8526"],
      [99_999n, "0.0001"],
      [12_345n, "0.000012"],
      [1n, "0.000000001"],
      [9_999_999n, "0.01"],
      [10_000_000n, "0.01"],
      [1_500_000_000n, "1.5"],
      [0n, "0"],
      ["-500000000", "−0.5"],
    ]) {
      assert.equal(formatDusk(lux, { locale: "en" }).text, text, String(lux));
    }
  });

  it("rounds down for balances, up for fees, and to the nearest otherwise", () => {
    for (const [lux, round, text] of /** @type {const} */ ([
      [1_853_542n, "down", "0.0018"],
      [1_853_542n, "up", "0.0019"],
      [1_850_000n, undefined, "0.0019"],
      [99_999n, "down", "0.000099"],
      [173_852_650_000n, "down", "173.8526"],
      [173_852_610_001n, "up", "173.8527"],
    ])) {
      assert.equal(formatDusk(lux, { locale: "en", round }).text, text, `${lux} ${round}`);
    }
  });

  it("never shows an amount that isn't 0 as 0, nor past it the wrong way", () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };

    for (let i = 0; i < 3000; i++) {
      const lux = BigInt(next()) ** BigInt(1 + (i % 3)) / BigInt(1 + (next() % 1000));

      if (lux === 0n) continue;

      const exact = Number(formatDuskPlain(lux));
      const down = Number(formatDusk(lux, { locale: "en", round: "down" }).text.replaceAll(",", ""));
      const up = Number(formatDusk(lux, { locale: "en", round: "up" }).text.replaceAll(",", ""));

      assert.ok(down > 0 && up > 0, String(lux));
      assert.ok(down <= exact && up >= exact, String(lux));
    }
  });

  it("gives the exact amount too, all 9 decimals with the zeros trimmed", () => {
    assert.deepEqual(formatDusk(173_852_610_026n, { locale: "en", mode: "exact" }), {
      exact: "173.852610026",
      text: "173.852610026",
    });
    assert.equal(formatDusk(1_000_000_000n, { mode: "exact", locale: "en" }).text, "1");
    assert.equal(formatDusk(123_456_789_012_345_678n, { locale: "en" }).exact, "123,456,789.012345678");
  });

  it("writes the separators and digits of the locale", () => {
    assert.deepEqual(formatDusk(173_852_610_026n, { locale: "nl-NL" }), {
      exact: "173,852610026",
      text: "173,8526",
    });
    assert.equal(formatDusk(123_456_789_012_345_678n, { locale: "de-DE" }).text, "123.456.789,0123");
    assert.equal(formatDusk(123_456_789_012_345_678n, { locale: "fr-FR" }).text, "123 456 789,0123");
    assert.equal(formatDusk(123_456_789_012_345_678n, { locale: "en-IN" }).text, "12,34,56,789.0123");
    assert.equal(formatDusk(1_853_542n, { locale: "ar-EG" }).text, "٠٫٠٠١٩");
  });

  it("writes a file's amount with a point and no grouping", () => {
    assert.equal(formatDuskPlain(173_852_610_026n), "173.852610026");
    assert.equal(formatDuskPlain(-1n), "-0.000000001");
    assert.equal(formatDuskPlain(1_234_000_000_000n), "1234");
    assert.equal(formatDuskPlain(0), "0");
  });

  it("refuses what isn't a whole number of lux", () => {
    for (const bad of [1.5, "1.5", "abc", null, undefined, Number.MAX_SAFE_INTEGER + 2]) {
      assert.throws(() => formatDusk(/** @type {any} */ (bad)), TypeError);
    }
    assert.throws(() => formatDusk(1n, { mode: /** @type {any} */ ("long") }), RangeError);
    assert.throws(() => formatDusk(1n, { round: /** @type {any} */ ("half") }), RangeError);
  });
});

describe("times", () => {
  // Wed 28 Oct 2026, 13:05:09 UTC: 14:05:09 in Amsterdam.
  const now = Date.UTC(2026, 9, 28, 13, 5, 9);
  const amsterdam = { locale: "nl-NL", now, timeZone: "Europe/Amsterdam" };

  it("says today and yesterday, dates older moments, and gives the weekday, year and seconds when asked", () => {
    for (const [date, options, expected] of /** @type {const} */ ([
      [now, {}, "Today, 14:05 CET"],
      [Date.UTC(2026, 9, 27, 22, 59), {}, "Yesterday, 23:59 CET"],
      [Date.UTC(2026, 9, 27, 23, 1), {}, "Today, 00:01 CET"],
      [Date.UTC(2026, 9, 26, 8, 12), {}, "26 Oct, 09:12 CET"],
      [Date.UTC(2025, 9, 26, 8, 12), {}, "26 Oct 2025, 09:12 CET"],
      [new Date(Date.UTC(2026, 6, 1, 12, 0)), {}, "1 Jul, 14:00 CEST"],
      [now, { date: "full" }, "Wed 28 Oct 2026, 14:05 CET"],
      [now, { seconds: true }, "Today, 14:05:09 CET"],
      ["2026-10-28T13:05:09Z", { date: "full", seconds: true }, "Wed 28 Oct 2026, 14:05:09 CET"],
    ])) {
      assert.equal(formatTime(date, { ...amsterdam, ...options }), expected);
    }
  });

  it("follows the locale's clock with English words, and names the zone in letters, else as GMT and the offset", () => {
    for (const [locale, timeZone, expected, options] of /** @type {const} */ ([
      ["en-US", "America/New_York", "Today, 9:05 AM EDT", {}],
      ["en-US", "America/New_York", "Wed 28 Oct 2026, 9:05 AM EDT", { date: "full" }],
      ["ko-KR", "Asia/Seoul", "Today, 10:05 PM GMT+9", {}],
      ["ja-JP", "Asia/Tokyo", "Today, 22:05 JST", {}],
      ["de-DE", "Europe/Berlin", "Today, 14:05 CET", {}],
      ["en-GB", "Europe/London", "Today, 13:05 GMT", {}],
      ["de-DE", "UTC", "Today, 13:05 UTC", {}],
      ["en-IN", "Asia/Kolkata", "Today, 6:35 pm IST", {}],
      ["nl-NL", "Asia/Kathmandu", "Today, 18:50 GMT+5:45", {}],
    ])) {
      assert.equal(spaced(formatTime(now, { locale, now, timeZone, ...options })), expected, `${locale} ${timeZone}`);
    }
  });

  it("refuses what isn't a date", () => {
    assert.throws(() => formatTime("not a date"), RangeError);
    assert.throws(() => formatTime(now, { date: /** @type {any} */ ("short") }), RangeError);
  });
});

describe("IDs", () => {
  const MULTICALL = "93de287b7d349d678a0038fe7772e8960e1a84a1b5da2d0b1f62f532616ce1d4";
  const ACCOUNT =
    "24jFms4JqYdWb19jFn3CUjNUQz1AeRozYnwsHuUkLbXAj2gRBq598aLAJmqmsaPcsCNJTgTaJTaUZCXpT3s9UeWBsHTmd5hQx95JymZSUsmtwoibiB8AMp4bZjAiLMjmAH3x";

  it("writes a contract ID without 0x, in lower case, cut in the middle when short", () => {
    assert.equal(formatContractId(`0x${MULTICALL.toUpperCase()}`), MULTICALL);
    assert.equal(formatContractId(MULTICALL, { short: true }), "93de28…6ce1d4");
    assert.throws(() => formatContractId("0x1234"), TypeError);
  });

  it("cuts an account to 6 characters at each end", () => {
    assert.equal(shortAccount(ACCOUNT), "24jFms…jmAH3x");
    assert.equal(shortAccount("abcdefghijklmno"), "abcdefghijklmno");
    assert.throws(() => shortAccount(/** @type {any} */ (42)), TypeError);
  });

  it("checksums EVM addresses as EIP-55's own examples", () => {
    for (const address of [
      "0x52908400098527886E0F7030069857D2E4169EE7",
      "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
      "0xde709f2102306220921060314715629080e2fb77",
      "0x27b1fdb04752bbc536007a920d24acb045561c26",
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
      "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
      "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
    ]) {
      assert.equal(formatEvmAddress(address.toLowerCase()), address);
    }
    assert.equal(formatEvmAddress("0x32979f040feb67a5223acb0716fe4c7a5956488c", { short: true }), "0x3297…488c");
    assert.throws(() => formatEvmAddress("32979f040feb67a5223acb0716fe4c7a5956488c"), TypeError);
  });
});

describe("Keccak-256", () => {
  const hex = (/** @type {Uint8Array} */ b) => Buffer.from(b).toString("hex");
  const text = (/** @type {string} */ s) => new TextEncoder().encode(s);

  it("gives the published hashes", () => {
    assert.equal(hex(keccak256(new Uint8Array(0))), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    assert.equal(hex(keccak256(text("abc"))), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
    assert.equal(
      hex(keccak256(text("The quick brown fox jumps over the lazy dog"))),
      "4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15"
    );
  });

  it("agrees with viem across the 136-byte block edges", () => {
    const bytes = (/** @type {number} */ n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 1) & 0xff);

    // Hashes of these inputs from viem's keccak256 (@noble/hashes).
    assert.equal(hex(keccak256(bytes(135))), "34bd7bed52ea092f88bc887256e7f06500ee814afa9a5566e22030af2ef1c5c0");
    assert.equal(hex(keccak256(bytes(136))), "2b31811a93dfc4bdc41b6aa7790e784b987c25a2c8a0e101cfa694552dc8ae39");
    assert.equal(hex(keccak256(bytes(137))), "a6103b089a404974c2b460048bfddd45108748fbdd9bad451f54d1fe95f8f284");
    assert.equal(hex(keccak256(bytes(272))), "415fd325cae3a2f957fea2770d710027317ced7e7266a59905102c14fdb9959a");
    assert.equal(hex(keccak256(bytes(500))), "3b57ae3adaa5ad96dd75bdfb7df2948b8842d947855d42f5ef338265bb6f5d86");
  });
});

describe("times and durations in words", () => {
  it("rounds an estimate up on a scale that reads at a glance", () => {
    assert.deepEqual(
      [45, 172, 600, 660, 3_400, 3_600, 4_000, 5_400, 5_460, 36_000, 608_200].map(aboutTime),
      ["~1 min", "~3 min", "~10 min", "~15 min", "~1 hour", "~1 hour", "~70 min", "~90 min", "~2 hours", "~10 hours", "~7 days"]
    );
    assert.equal(aboutTime(0), "~1 min");
    assert.equal(aboutTime(36_000n), "~10 hours");
  });

  it("says an estimate in words", () => {
    assert.deepEqual(
      [45, 1_700, 3_600, 4_000, 36_000, 608_200].map(aboutWords),
      ["about 1 minute", "about 30 minutes", "about 1 hour", "about 70 minutes", "about 10 hours", "about 7 days"]
    );
  });

  it("says a duration in whole words, to the minute and down", () => {
    for (const [seconds, words] of /** @type {const} */ ([
      [20, "less than a minute"],
      [59, "less than a minute"],
      [-5, "less than a minute"],
      [60, "1 minute"],
      [61, "1 minute"],
      [5_400, "1 hour 30 minutes"],
      [3 * 3_600 + 12 * 60, "3 hours 12 minutes"],
      [3_600, "1 hour"],
      [86_400, "1 day"],
      [90_000, "1 day 1 hour"],
      [302_400n, "3 days 12 hours"],
      [604_800n, "7 days"],
      [5 * 86_400 + 3 * 3_600 + 59, "5 days 3 hours"],
    ])) {
      assert.equal(durationWords(seconds), words, String(seconds));
    }
  });
});
