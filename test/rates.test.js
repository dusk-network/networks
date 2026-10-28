import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  BLOCK_TIME_SECONDS,
  EMISSION_SCHEDULE,
  MINIMUM_STAKE_LUX,
  PROVISIONER_SHARE,
  eligibleStake,
  emissionAt,
  nativeRateEstimate,
  sozuRateEstimate,
} from "../src/rates.js";

const LUX = 1_000_000_000n;

/** Mainnet's provisioners on 28 Oct 2026, parsed as an app parses the reply. */
const snapshot = JSON.parse(
  readFileSync(new URL("./fixtures/mainnet-provisioners.json", import.meta.url), "utf8")
);

/** A rate as a percentage to one decimal, as the research quotes it. */
const percent = (/** @type {number | null} */ rate) => Math.round(Number(rate) * 1000) / 10;

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
    // Each period's blocks, p·PERIOD + 1 to (p + 1)·PERIOD, as Rusk's test
    // sums them, against the heights each entry of the schedule holds for.
    const periods = expected.map((_, p) => {
      let sum = 0n;

      EMISSION_SCHEDULE.forEach(({ lastHeight, lux }, i) => {
        const first = i === 0 ? 0 : EMISSION_SCHEDULE[i - 1].lastHeight + 1;
        const from = Math.max(first, p * PERIOD + 1);
        const to = Math.min(lastHeight, (p + 1) * PERIOD);

        if (to >= from) sum += BigInt(to - from + 1) * lux;
      });

      return sum;
    });

    assert.deepEqual(periods, expected);
    assert.equal(
      periods.reduce((a, b) => a + b, 0n),
      500_000_000n * LUX
    );
  });

  it("gives each height its period's emission, and nothing past the last mint", () => {
    assert.equal(emissionAt(0), 0n);
    assert.equal(emissionAt(1), 19_857_400_000n);
    assert.equal(emissionAt(12_614_400), 19_857_400_000n);
    assert.equal(emissionAt(12_614_401n), 9_928_700_000n);
    assert.equal(emissionAt(113_529_596), 77_570_000n);
    assert.equal(emissionAt(113_529_597), 54_280_000n);
    assert.equal(emissionAt(113_529_598), 0n);
    assert.throws(() => emissionAt(-1), RangeError);
    assert.throws(() => emissionAt(1.5), RangeError);
  });
});

describe("the eligible stake", () => {
  it("counts stakes of 1,000 DUSK or more that are eligible at the tip: 208,048,559 DUSK on 28 Oct 2026", () => {
    const stake = eligibleStake(snapshot.provisioners, snapshot.tipHeight);
    const exact = 208_048_559_344_848_629n;

    // JSON.parse reads two amounts above 2^53 a lux off.
    assert.ok(stake - exact <= 10n && exact - stake <= 10n, String(stake));
    assert.equal(stake / LUX, 208_048_559n);
    assert.equal(
      snapshot.provisioners.filter(
        (/** @type {any} */ p) => p.eligibility <= snapshot.tipHeight && p.amount >= 1e12
      ).length,
      176
    );
  });

  it("takes amounts as strings and bigints exactly, and leaves out the rest", () => {
    const tip = 100;

    assert.equal(
      eligibleStake(
        [
          { amount: "208048559344848629", eligibility: 1 },
          { amount: MINIMUM_STAKE_LUX, eligibility: 100 },
          { amount: MINIMUM_STAKE_LUX - 1n, eligibility: 1 },
          { amount: 5_000_000_000_000, eligibility: 101 },
          { amount: "abc", eligibility: 1 },
          { eligibility: 1 },
          /** @type {any} */ (null),
        ],
        tip
      ),
      208_048_559_344_848_629n + MINIMUM_STAKE_LUX
    );
    assert.throws(() => eligibleStake(/** @type {any} */ ({}), tip), TypeError);
  });
});

describe("the reward rates", () => {
  it("estimates native staking at 23.5% a year from the snapshot", () => {
    const rate = nativeRateEstimate(snapshot);

    assert.equal(percent(rate), 23.5);
    assert.equal(PROVISIONER_SHARE, 0.78);
    assert.equal(BLOCK_TIME_SECONDS, 10);
    // E × s × Y ÷ S, by hand.
    assert.ok(
      Math.abs(
        Number(rate) - (19.8574 * 0.78 * ((365.25 * 86400) / 10)) / 208_048_559.344848629
      ) < 1e-12
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
