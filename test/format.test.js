import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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
    assert.equal(formatDusk(173_852_610_026n, { locale: "en" }).text, "173.8526");
    assert.equal(formatDusk(99_999n, { locale: "en" }).text, "0.0001");
    assert.equal(formatDusk(12_345n, { locale: "en" }).text, "0.000012");
    assert.equal(formatDusk(1n, { locale: "en" }).text, "0.000000001");
    assert.equal(formatDusk(9_999_999n, { locale: "en" }).text, "0.01");
    assert.equal(formatDusk(10_000_000n, { locale: "en" }).text, "0.01");
    assert.equal(formatDusk(1_500_000_000n, { locale: "en" }).text, "1.5");
    assert.equal(formatDusk(0n, { locale: "en" }).text, "0");
    assert.equal(formatDusk("-500000000", { locale: "en" }).text, "−0.5");
  });

  it("rounds down for balances, up for fees, and to the nearest otherwise", () => {
    assert.equal(formatDusk(1_853_542n, { locale: "en", round: "down" }).text, "0.0018");
    assert.equal(formatDusk(1_853_542n, { locale: "en", round: "up" }).text, "0.0019");
    assert.equal(formatDusk(1_850_000n, { locale: "en" }).text, "0.0019");
    assert.equal(formatDusk(99_999n, { locale: "en", round: "down" }).text, "0.000099");
    assert.equal(formatDusk(173_852_650_000n, { locale: "en", round: "down" }).text, "173.8526");
    assert.equal(formatDusk(173_852_610_001n, { locale: "en", round: "up" }).text, "173.8527");
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

  it("says today and yesterday, in English, with the zone", () => {
    assert.equal(formatTime(now, amsterdam), "Today, 14:05 CET");
    assert.equal(formatTime(Date.UTC(2026, 9, 27, 22, 59), amsterdam), "Yesterday, 23:59 CET");
    assert.equal(formatTime(Date.UTC(2026, 9, 27, 23, 1), amsterdam), "Today, 00:01 CET");
  });

  it("dates older moments, with the year when it isn't this one", () => {
    assert.equal(formatTime(Date.UTC(2026, 9, 26, 8, 12), amsterdam), "26 Oct, 09:12 CET");
    assert.equal(formatTime(Date.UTC(2025, 9, 26, 8, 12), amsterdam), "26 Oct 2025, 09:12 CET");
    assert.equal(formatTime(new Date(Date.UTC(2026, 6, 1, 12, 0)), amsterdam), "1 Jul, 14:00 CEST");
  });

  it("gives the weekday and the year in full, and seconds when asked", () => {
    assert.equal(formatTime(now, { ...amsterdam, date: "full" }), "Wed 28 Oct 2026, 14:05 CET");
    assert.equal(formatTime(now, { ...amsterdam, seconds: true }), "Today, 14:05:09 CET");
    assert.equal(
      formatTime("2026-10-28T13:05:09Z", { ...amsterdam, date: "full", seconds: true }),
      "Wed 28 Oct 2026, 14:05:09 CET"
    );
  });

  it("follows the locale's clock, and keeps the words English", () => {
    const newYork = { locale: "en-US", now, timeZone: "America/New_York" };

    assert.equal(spaced(formatTime(now, newYork)), "Today, 9:05 AM EDT");
    assert.equal(spaced(formatTime(now, { ...newYork, date: "full" })), "Wed 28 Oct 2026, 9:05 AM EDT");
    assert.equal(spaced(formatTime(now, { locale: "ko-KR", now, timeZone: "Asia/Seoul" })), "Today, 10:05 PM GMT+9");
    assert.equal(formatTime(now, { locale: "ja-JP", now, timeZone: "Asia/Tokyo" }), "Today, 22:05 JST");
    assert.equal(formatTime(now, { locale: "de-DE", now, timeZone: "Europe/Berlin" }), "Today, 14:05 CET");
  });

  it("names the zone in letters where Intl has them, else as GMT and the offset", () => {
    assert.equal(formatTime(now, { locale: "en-GB", now, timeZone: "Europe/London" }), "Today, 13:05 GMT");
    assert.equal(formatTime(now, { locale: "de-DE", now, timeZone: "UTC" }), "Today, 13:05 UTC");
    assert.equal(spaced(formatTime(now, { locale: "en-IN", now, timeZone: "Asia/Kolkata" })), "Today, 6:35 pm IST");
    assert.equal(formatTime(now, { locale: "nl-NL", now, timeZone: "Asia/Kathmandu" }), "Today, 18:50 GMT+5:45");
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
