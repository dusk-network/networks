/**
 * Staking reward rates, from one read of the node's provisioners and a few
 * constants: simple yearly rates for the network as a whole, as fractions.
 *
 * @module
 */

/**
 * DUSK minted per block, in lux, as Rusk 1.7.1 mints it: each period's last
 * height and what its blocks mint, from the block after the previous one's.
 * Nine periods of 12,614,400 blocks, each about half the one before, then
 * one last mint: 500,000,000 DUSK in all.
 *
 * @type {ReadonlyArray<readonly [number, bigint]>}
 */
const EMISSION = [
  [0, 0n],
  [12_614_400, 19_857_400_000n],
  [25_228_800, 9_928_700_000n],
  [37_843_200, 4_964_350_000n],
  [50_457_600, 2_482_180_000n],
  [63_072_000, 1_241_090_000n],
  [75_686_400, 620_540_000n],
  [88_300_800, 310_270_000n],
  [100_915_200, 155_140_000n],
  [113_529_596, 77_570_000n],
  [113_529_597, 54_280_000n],
];

/**
 * The share of each block's reward that reaches provisioners. 10% goes to
 * Dusk's development fund, 70% to the block's generator, and up to 10% each
 * to the generator's extra and to the voters, by the credits the block
 * carries; credit shares that aren't used are never minted. So it lies
 * between 0.767 (quorum only) and 0.90 (all 128 credits). 0.78 is what
 * mainnet blocks and Sozu's harvests paid in October 2026; measure it again
 * now and then.
 */
const PROVISIONER_SHARE = 0.78;

/** Seconds per block: the target, and mainnet's average over October 2026. */
const BLOCK_TIME_SECONDS = 10;

/** The least stake consensus counts, in lux: 1,000 DUSK. */
const MINIMUM_STAKE_LUX = 1_000_000_000_000n;

const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;

/**
 * @param {unknown} value
 * @returns {number | null}
 */
const heightOf = (value) => {
  const height = typeof value === "bigint" ? Number(value) : value;

  return typeof height === "number" && Number.isSafeInteger(height) && height >= 0
    ? height
    : null;
};

/**
 * @param {unknown} value
 * @returns {bigint}
 */
const luxOf = (value) => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Amounts above 2^53 lux reach here a few lux off, from JSON.parse.
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return 0n;
};

/**
 * What a block at `height` mints, in lux, without its fees.
 *
 * @param {number} height
 */
const emissionAt = (height) => EMISSION.find(([last]) => height <= last)?.[1] ?? 0n;

/**
 * The stake consensus counts at `tip`, in lux: `amount` (not `locked`) of
 * the provisioners eligible at the tip with at least 1,000 DUSK.
 *
 * @param {ReadonlyArray<{ amount?: unknown, eligibility?: unknown }>} provisioners
 * @param {number} tip
 */
function eligibleStake(provisioners, tip) {
  let sum = 0n;

  for (const provisioner of provisioners) {
    const amount = luxOf(provisioner?.amount);
    const eligibility = heightOf(provisioner?.eligibility);

    if (eligibility !== null && eligibility <= tip && amount >= MINIMUM_STAKE_LUX) {
      sum += amount;
    }
  }

  return sum;
}

/**
 * E × s × Y ÷ S: what a block at the tip mints, the provisioners' share,
 * the blocks in a year of 365.25 days, and the eligible stake.
 *
 * @param {{
 *   provisioners: ReadonlyArray<{ amount?: unknown, eligibility?: unknown }>,
 *   tipHeight: number | bigint,
 *   blockTimeSeconds?: number,
 * }} options
 * @returns {number | null}
 */
export function nativeRateEstimate({
  provisioners,
  tipHeight,
  blockTimeSeconds = BLOCK_TIME_SECONDS,
}) {
  if (!(typeof blockTimeSeconds === "number" && blockTimeSeconds > 0)) {
    throw new RangeError("A block time is a number of seconds, more than 0");
  }

  const tip = heightOf(tipHeight);

  if (!Array.isArray(provisioners) || tip === null) {
    throw new TypeError("Give the node's provisioners and a block height");
  }

  const stake = eligibleStake(provisioners, tip);

  if (stake === 0n) {
    return null;
  }

  return (
    (Number(emissionAt(tip)) * PROVISIONER_SHARE * (SECONDS_PER_YEAR / blockTimeSeconds)) /
    Number(stake)
  );
}

/**
 * @param {unknown} fee
 * @returns {number | null}
 */
function feeFraction(fee) {
  if (typeof fee === "number") {
    return Number.isFinite(fee) ? fee : null;
  }

  if (fee && typeof fee === "object") {
    const { numerator, denominator } = /** @type {Record<string, unknown>} */ (
      fee
    );
    const d = Number(denominator);
    const n = Number(numerator);

    if (!Number.isFinite(n) || !Number.isFinite(d)) return null;

    // As Sozu's pool counts a fee rate without a denominator: no fee.
    return d > 0 ? n / d : 0;
  }

  return null;
}

/**
 * native × (1 − fee). Sozu restakes every hour, so its stDUSK compounds a
 * little over this.
 *
 * @param {number | null} native
 * @param {{ numerator: bigint | number | string, denominator: bigint | number | string } | number | null} rewardFee
 * @returns {number | null}
 */
export function sozuRateEstimate(native, rewardFee) {
  const fee = feeFraction(rewardFee);

  if (typeof native !== "number" || !Number.isFinite(native) || fee === null) {
    return null;
  }

  return native * (1 - Math.min(Math.max(fee, 0), 1));
}
