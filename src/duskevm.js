/* @ts-self-types="./duskevm.d.ts" */
/**
 * When a DuskEVM withdrawal can be claimed on Dusk, worked out the way the
 * Portal checks a claim:
 * - the proof has matured: `proofMaturityDelaySeconds` after it was made;
 * - its dispute game has resolved for its proposal and is final:
 *   `disputeGameFinalityDelaySeconds` after it resolved.
 * It's exact once the game has resolved. Before that, the game resolves no
 * sooner than its clock runs out (`maxClockDuration` after it was created),
 * which gives the earliest date, an estimate.
 *
 * The times are the contracts' own. The deployed testnet contracts count
 * Dusk block height × 10; the others count block time and compare
 * strictly, so a claim there comes a second later. Pure: each app reads the
 * game, the Portal and Dusk's latest block itself, and passes them in.
 *
 * @module
 */

/** @typedef {import("./duskevm.js").DuskTip} DuskTip */
/** @typedef {import("./duskevm.js").ContractClock} ContractClock */
/** @typedef {import("./duskevm.js").ClaimDate} ClaimDate */

/** A dispute game's status, as its hub gives it. */
export const GAME_STATUS = Object.freeze({
  CHALLENGER_WINS: 1,
  DEFENDER_WINS: 2,
  IN_PROGRESS: 0,
});

/** A game still unresolved this long past the earliest it could resolve is overdue. */
export const OVERDUE_SECONDS = 3_600n;

/** @type {ClaimDate} */
const NO_DATE = Object.freeze({ at: null, exact: false, overdue: false });

/**
 * @param {bigint} a
 * @param {bigint} b
 */
const distance = (a, b) => (a > b ? a - b : b - a);

/**
 * @param {bigint} a
 * @param {bigint} b
 */
const later = (a, b) => (a > b ? a : b);

/**
 * At the tip the two clocks are decades apart, so a time is on whichever
 * it's nearer.
 *
 * @param {bigint | number} sample
 * @param {DuskTip} tip
 * @returns {ContractClock}
 */
export function contractClock(sample, tip) {
  const time = BigInt(sample);

  return distance(time, 10n * BigInt(tip.height)) < distance(time, BigInt(tip.timestamp))
    ? "height"
    : "timestamp";
}

/**
 * @param {ContractClock} clock
 * @param {DuskTip} tip
 * @returns {bigint}
 */
export const contractNow = (clock, tip) =>
  clock === "height" ? 10n * BigInt(tip.height) : BigInt(tip.timestamp);

/**
 * On the height clock a time is counted from the tip, at Dusk's 10 seconds
 * a block.
 *
 * @param {bigint | number} seconds
 * @param {ContractClock} clock
 * @param {DuskTip} tip
 * @returns {number}
 */
export function wallTime(seconds, clock, tip) {
  const time = BigInt(seconds);
  const wall = clock === "height" ? BigInt(tip.timestamp) + time - 10n * BigInt(tip.height) : time;

  return Number(wall) * 1_000;
}

/**
 * @param {import("./duskevm.js").ClaimInput} input
 * @returns {ClaimDate}
 */
export function claimFrom({ clock, game, portal, provenAt = null, tip }) {
  if (!game) {
    return NO_DATE;
  }

  const created = BigInt(game.createdAt);
  const status = Number(game.status);

  if (created === 0n || status === GAME_STATUS.CHALLENGER_WINS) {
    return NO_DATE;
  }

  const counted = clock ?? contractClock(created, tip);
  const now = contractNow(counted, tip);
  // A block-time deployment compares strictly: a second after the delay.
  const strict = counted === "height" ? 0n : 1n;
  const resolved = status === GAME_STATUS.DEFENDER_WINS;
  // The earliest the game resolves: once its clock has run out, and not before now.
  const settles = created + BigInt(game.maxClockDuration);
  const resolvedAt = resolved ? BigInt(game.resolvedAt) : later(now, settles);
  const matured = (provenAt ? BigInt(provenAt) : now) + BigInt(portal.proofMaturityDelaySeconds);
  const final = resolvedAt + BigInt(portal.disputeGameFinalityDelaySeconds);

  return {
    at: wallTime(later(matured, final) + strict, counted, tip),
    exact: resolved,
    overdue: !resolved && now > settles + OVERDUE_SECONDS,
  };
}

/**
 * A claim is ready from its date only: a Portal whose check takes just the
 * proof and its game says yes before it, and refuses the claim itself. A
 * date that has passed while the Portal still refuses the claim says
 * nothing more.
 *
 * @param {{ claim: ClaimDate | null | undefined, portalAccepts: boolean, tip: DuskTip }} input
 * @returns {import("./duskevm.js").ClaimReadiness}
 */
export function claimReadiness({ claim, portalAccepts, tip }) {
  const readyAt = claim?.at == null ? null : BigInt(Math.floor(claim.at / 1_000));
  const due = readyAt === null || readyAt <= BigInt(tip.timestamp);

  if (portalAccepts && due) {
    return { claimOverdue: false, ready: true, readyAt, readyAtExact: Boolean(claim?.exact), refused: false };
  }

  const refused = !portalAccepts && readyAt !== null && due;

  return {
    claimOverdue: Boolean(claim?.overdue),
    ready: false,
    readyAt: refused ? null : readyAt,
    readyAtExact: refused ? false : Boolean(claim?.exact),
    refused,
  };
}

/**
 * @param {{ createdAt: bigint | number, l2BlockNumber: bigint | number }} game
 * @param {import("./duskevm.js").GameRules} rules
 * @returns {boolean}
 */
export const isCandidateGame = (game, { respectedGameTypeUpdatedAt, withdrawalBlockNumber }) =>
  BigInt(game.l2BlockNumber) >= BigInt(withdrawalBlockNumber) &&
  BigInt(game.createdAt) > BigInt(respectedGameTypeUpdatedAt);

/**
 * @param {import("./duskevm.js").GameCheck} game
 * @param {import("./duskevm.js").GameRules} rules
 * @returns {boolean}
 */
export const isEligibleGame = (game, rules) =>
  isCandidateGame(game, rules) &&
  game.status != null &&
  Number(game.status) === GAME_STATUS.DEFENDER_WINS &&
  game.proper === true &&
  game.respected === true;
