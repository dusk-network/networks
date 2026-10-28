/**
 * Staking reward rates, estimated from one read of the node's provisioners
 * and a few constants. Each is a simple yearly rate for the network as a
 * whole, as a fraction (0.235 is 23.5% a year): rewards collect in a stake's
 * reward balance and don't compound unless they're claimed and staked
 * again. A single stake's own result varies, and nothing here is promised.
 *
 * @module
 */

/**
 * DUSK minted per block, in lux, as the node mints it (Rusk 1.7.1): nine
 * periods of 12,614,400 blocks (four years of 10-second blocks), each about
 * half the one before, then one last mint, 500,000,000 DUSK in all. Each
 * entry holds from the block after the previous entry's last height.
 */
export const EMISSION_SCHEDULE = Object.freeze(
  /** @type {const} */ ([
    Object.freeze({ lastHeight: 0, lux: 0n }),
    Object.freeze({ lastHeight: 12_614_400, lux: 19_857_400_000n }),
    Object.freeze({ lastHeight: 25_228_800, lux: 9_928_700_000n }),
    Object.freeze({ lastHeight: 37_843_200, lux: 4_964_350_000n }),
    Object.freeze({ lastHeight: 50_457_600, lux: 2_482_180_000n }),
    Object.freeze({ lastHeight: 63_072_000, lux: 1_241_090_000n }),
    Object.freeze({ lastHeight: 75_686_400, lux: 620_540_000n }),
    Object.freeze({ lastHeight: 88_300_800, lux: 310_270_000n }),
    Object.freeze({ lastHeight: 100_915_200, lux: 155_140_000n }),
    Object.freeze({ lastHeight: 113_529_596, lux: 77_570_000n }),
    Object.freeze({ lastHeight: 113_529_597, lux: 54_280_000n }),
  ])
);

/**
 * The share of each block's reward that reaches provisioners. 10% goes to
 * Dusk's development fund, 70% to the block's generator, and up to 10% each
 * to the generator's extra and to the voters, by the credits the block
 * carries; credit shares that aren't used are never minted. So it lies
 * between 0.767 (quorum only) and 0.90 (all 128 credits). 0.78 is what
 * mainnet blocks and Sozu's harvests paid in October 2026; measure it again
 * now and then.
 */
export const PROVISIONER_SHARE = 0.78;

/** Seconds per block: the target, and mainnet's average over October 2026. */
export const BLOCK_TIME_SECONDS = 10;

/** The least stake consensus counts, in lux: 1,000 DUSK. */
export const MINIMUM_STAKE_LUX = 1_000_000_000_000n;

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
 * The DUSK a block at `height` mints, in lux, without its fees.
 *
 * @param {number | bigint} height
 * @returns {bigint}
 */
export function emissionAt(height) {
  const at = heightOf(height);

  if (at === null) {
    throw new RangeError("A block height is a whole number, 0 or more");
  }

  return EMISSION_SCHEDULE.find(({ lastHeight }) => at <= lastHeight)?.lux ?? 0n;
}

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
 * The stake consensus counts at `tipHeight`, in lux: the sum of `amount`
 * (not `locked`) over provisioners whose `eligibility` is at or below the
 * tip and who stake at least 1,000 DUSK. `provisioners` is the node's
 * `/on/node/provisioners` reply.
 *
 * @param {ReadonlyArray<{ amount?: unknown, eligibility?: unknown }>} provisioners
 * @param {number | bigint} tipHeight
 * @returns {bigint}
 */
export function eligibleStake(provisioners, tipHeight) {
  const tip = heightOf(tipHeight);

  if (!Array.isArray(provisioners) || tip === null) {
    throw new TypeError("Give the node's provisioners and a block height");
  }

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
 * About what native staking pays a year across the network, as a simple
 * rate: E × s × Y ÷ S, with E what a block at the tip mints, s the
 * provisioners' share (PROVISIONER_SHARE), Y the blocks in a year of 365.25
 * days at `blockTimeSeconds`, and S the eligible stake. Null when nothing is
 * staked.
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

  const stake = eligibleStake(provisioners, tipHeight);

  if (stake === 0n) {
    return null;
  }

  const blocksPerYear = SECONDS_PER_YEAR / blockTimeSeconds;

  return (
    (Number(emissionAt(tipHeight)) * PROVISIONER_SHARE * blocksPerYear) /
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
 * About what Sozu pays a year: the native estimate less Sozu's reward fee,
 * native × (1 − fee). `rewardFee` is the substrate's reward fee rate
 * (`{ numerator, denominator }`, as `readSozuStatus` gives it) or a
 * fraction. Sozu restakes every hour, so its stDUSK compounds a little over
 * this. Null without a native estimate or a fee.
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
