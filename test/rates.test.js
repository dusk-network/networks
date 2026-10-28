import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { nativeRateEstimate, sozuRateEstimate } from "../src/rates.js";

const LUX = 1_000_000_000n;
const YEAR = 365.25 * 24 * 60 * 60;

/** Mainnet's provisioners that count on 28 Oct 2026, parsed as an app parses the reply. */
const snapshot = JSON.parse(
  readFileSync(new URL("./fixtures/mainnet-provisioners.json", import.meta.url), "utf8")
);

/** A rate as a percentage to one decimal, as the research quotes it. */
const percent = (/** @type {number | null} */ rate) => Math.round(Number(rate) * 1000) / 10;

/**
 * What a block at `height` mints, in lux, read back from the rate: one
 * provisioner with 1,000 DUSK, and a block time that makes s × Y one.
 *
 * @param {number | bigint} height
 */
const emissionAt = (height) =>
  BigInt(
    Math.round(
      Number(
        nativeRateEstimate({
          blockTimeSeconds: YEAR * 0.78,
          provisioners: [{ amount: 1e12, eligibility: 0 }],
          tipHeight: height,
        })
      ) * 1e12
    )
  );

describe("the emission schedule", () => {
  it("mints what Rusk 1.7.1's own test expects in each period, 500M DUSK in all", () => {
    // EXPECTED_PERIOD_EMISSIONS in the node's emission tests, in DUSK.
    const expected = [
      "250489186.56", "125244593.28", "62622296.64", "31311211.392", "15655605.696",
      "7827739.776", "3913869.888", "1956998.016", "978498.752",
    ].map((dusk) => {
      const [whole, fraction = ""] = dusk.split(".");

      return BigInt(whole) * LUX + BigInt(fraction.padEnd(9, "0"));
    });
    const PERIOD = 12_614_400;
    /**
     * What blocks `from` to `to` mint. The emission never rises, so ends
     * that mint the same hold for every block between them.
     *
     * @param {number} from
     * @param {number} to
     * @returns {bigint}
     */
    const minted = (from, to) => {
      const first = emissionAt(from);

      if (first === emissionAt(to)) return BigInt(to - from + 1) * first;

      const middle = Math.floor((from + to) / 2);

      return minted(from, middle) + minted(middle + 1, to);
    };
    const periods = expected.map((_, p) => minted(p * PERIOD + 1, (p + 1) * PERIOD));

    assert.deepEqual(periods, expected);
    assert.equal(
      periods.reduce((a, b) => a + b, 0n),
      500_000_000n * LUX
    );
  });

  it("gives each height its period's emission, and nothing past the last mint", () => {
    for (const [height, lux] of [
      [0, 0n],
      [1, 19_857_400_000n],
      [12_614_400, 19_857_400_000n],
      [12_614_401n, 9_928_700_000n],
      [113_529_596, 77_570_000n],
      [113_529_597, 54_280_000n],
      [113_529_598, 0n],
    ]) {
      assert.equal(emissionAt(height), lux, String(height));
    }

    for (const height of [-1, 1.5]) {
      assert.throws(() => emissionAt(height), TypeError, String(height));
    }
  });
});

describe("the eligible stake", () => {
  it("counts stakes of 1,000 DUSK or more that are eligible at the tip: 208,048,559 DUSK on 28 Oct 2026", () => {
    // As one provisioner with all of it.
    const total = { amount: "208048559344848629", eligibility: 0 };

    assert.equal(
      nativeRateEstimate(snapshot),
      nativeRateEstimate({ provisioners: [total], tipHeight: snapshot.tipHeight })
    );
    assert.equal(
      snapshot.provisioners.filter(
        (/** @type {any} */ p) => p.eligibility <= snapshot.tipHeight && p.amount >= 1e12
      ).length,
      176
    );
  });

  it("takes amounts as numbers, strings and bigints, and leaves out the rest", () => {
    const tip = 100;
    const counted = [
      { amount: "208048559344848629", eligibility: 1 },
      { amount: 1_000_000_000_000n, eligibility: 100 },
      { amount: 999_999_999_999n, eligibility: 1 },
      { amount: 5_000_000_000_000, eligibility: 101 },
      { amount: "abc", eligibility: 1 },
      { eligibility: 1 },
      /** @type {any} */ (null),
    ];

    assert.equal(
      nativeRateEstimate({ provisioners: counted, tipHeight: tip }),
      nativeRateEstimate({
        provisioners: [{ amount: 208_048_559_344_848_629n + 1_000_000_000_000n, eligibility: 1 }],
        tipHeight: tip,
      })
    );
    assert.throws(() => nativeRateEstimate({ provisioners: /** @type {any} */ ({}), tipHeight: tip }), TypeError);
  });
});

describe("the reward rates", () => {
  it("estimates native staking at 23.5% a year from the snapshot", () => {
    const rate = nativeRateEstimate(snapshot);

    assert.equal(percent(rate), 23.5);
    // E × s × Y ÷ S, by hand: 0.78 of 19.8574 DUSK a block, 10-second blocks.
    assert.ok(
      Math.abs(Number(rate) - (19.8574 * 0.78 * (YEAR / 10)) / 208_048_559.344848629) < 1e-12
    );
  });

  it("estimates Sozu at 20.0% a year after its 15%", () => {
    const native = nativeRateEstimate(snapshot);

    assert.equal(percent(sozuRateEstimate(native, { denominator: 100n, numerator: 15n })), 20.0);
    assert.equal(percent(sozuRateEstimate(native, 0.15)), 20.0);
    assert.equal(percent(sozuRateEstimate(native, { denominator: "100", numerator: "10" })), 21.1);
  });

  it("pays less with slower blocks, and nothing it can't work out", () => {
    const at10 = Number(nativeRateEstimate(snapshot));
    const at1025 = Number(nativeRateEstimate({ ...snapshot, blockTimeSeconds: 10.25 }));

    assert.ok(Math.abs(at1025 - (at10 * 10) / 10.25) < 1e-12);
    assert.equal(nativeRateEstimate({ provisioners: [], tipHeight: 1 }), null);
    assert.throws(() => nativeRateEstimate({ ...snapshot, blockTimeSeconds: 0 }), RangeError);
    assert.equal(sozuRateEstimate(null, 0.15), null);
    assert.equal(sozuRateEstimate(0.2, null), null);
    assert.equal(sozuRateEstimate(0.2, { denominator: 0n, numerator: 1n }), 0.2);
    assert.equal(sozuRateEstimate(0.2, 2), 0);
  });
});
