/**
 * When a DuskEVM withdrawal can be claimed on Dusk, worked out the way the
 * Portal checks a claim: from the later of the proof's maturity
 * (`proofMaturityDelaySeconds` after it was made) and its dispute game's
 * finality (`disputeGameFinalityDelaySeconds` after the game resolved).
 * Exact once the game has resolved; before that, the earliest it can be,
 * from the game's clock (`maxClockDuration`). Pure: each app reads the
 * game, the Portal and Dusk's latest block itself.
 *
 * @example
 * ```js
 * import { claimFrom, claimReadiness } from "@dusk/networks/duskevm";
 *
 * const claim = claimFrom({
 *   provenAt: 46_877_440n, // the Portal's proof time
 *   game: { createdAt: 46_876_050n, resolvedAt: 0n, status: 0, maxClockDuration: 302_400n },
 *   portal: { proofMaturityDelaySeconds: 604_800n, disputeGameFinalityDelaySeconds: 302_400n },
 *   tip: { height: 4_704_959n, timestamp: 1_793_156_989n }, // Dusk's latest block
 * });
 * // { at: Date.UTC(2026, 10, 2, 3, 20, 39), exact: false, overdue: false }: "about Mon 2 Nov, 04:20 CET"
 * claimReadiness({ claim, portalAccepts: false, tip }); // { ready: false, readyAt: 1793589639n, … }
 * ```
 *
 * @module
 */

/** Dusk's latest block: its height, and its time in seconds. */
export type DuskTip = { height: bigint | number; timestamp: bigint | number };

/** What a deployment's contracts count: Dusk block height × 10 (testnet), or block time. */
export type ContractClock = "height" | "timestamp";

/** A dispute game as its hub gives it, with the hub's clock limit. */
export type ClaimGame = {
  createdAt: bigint | number;
  resolvedAt: bigint | number;
  status: number;
  maxClockDuration: bigint | number;
};

/** The Portal's two delays, in the contracts' seconds. */
export type PortalDelays = {
  proofMaturityDelaySeconds: bigint | number;
  disputeGameFinalityDelaySeconds: bigint | number;
};

/** What `claimFrom` takes. */
export type ClaimInput = {
  /** The Portal's proof time, in the contracts' time; none for a proof made now. */
  provenAt?: bigint | number | null;
  /** The proof's dispute game; none when it couldn't be read. */
  game: ClaimGame | null | undefined;
  portal: PortalDelays;
  tip: DuskTip;
  /** The deployment's clock; read from the game's own time when not given. */
  clock?: ContractClock;
};

/**
 * When a withdrawal can be claimed: `at` in milliseconds, `exact` once the
 * game has resolved (else "about"), `overdue` when the game is more than
 * an hour late to resolve. `at` is null when the challenger won, or the hub
 * doesn't know the game.
 */
export type ClaimDate = { at: number | null; exact: boolean; overdue: boolean };

/**
 * What a claim date means now: `ready` to claim, from when (`readyAt`, in
 * seconds), and `refused` when the date has passed while the Portal still
 * refuses the claim, so the date says nothing more.
 */
export type ClaimReadiness = {
  ready: boolean;
  readyAt: bigint | null;
  readyAtExact: boolean;
  claimOverdue: boolean;
  refused: boolean;
};

/** What decides which games a proof can go against. */
export type GameRules = {
  /** The anchor state registry's `respectedGameTypeUpdatedAt`: games created then or before are retired. */
  respectedGameTypeUpdatedAt: bigint | number;
  /** The L2 block of the withdrawal: a game must cover it. */
  withdrawalBlockNumber: bigint | number;
};

/** A game with its hub's status and the registry's answers; null where one couldn't be read. */
export type GameCheck = {
  createdAt: bigint | number;
  l2BlockNumber: bigint | number;
  status: number | null;
  proper: boolean | null;
  respected: boolean | null;
};

/** A dispute game's status, as its hub gives it. */
export declare const GAME_STATUS: Readonly<{ IN_PROGRESS: 0; CHALLENGER_WINS: 1; DEFENDER_WINS: 2 }>;

/** A game still unresolved this long past the earliest it could resolve is overdue: an hour. */
export declare const OVERDUE_SECONDS: bigint;

/** The clock a deployment's contracts keep, read from one of their times and the tip. */
export declare function contractClock(sample: bigint | number, tip: DuskTip): ContractClock;

/** The contracts' time at the tip. */
export declare function contractNow(clock: ContractClock, tip: DuskTip): bigint;

/** A contract time as wall-clock milliseconds. */
export declare function wallTime(seconds: bigint | number, clock: ContractClock, tip: DuskTip): number;

/**
 * When a withdrawal can be claimed: from max(proof + maturity, game
 * resolved + finality), exact once the game has resolved, the earliest
 * before.
 */
export declare function claimFrom(input: ClaimInput): ClaimDate;

/**
 * Whether a proven withdrawal can be claimed now: once the Portal's check
 * passes and its date has come, not before.
 */
export declare function claimReadiness(input: {
  claim: ClaimDate | null | undefined;
  portalAccepts: boolean;
  tip: DuskTip;
}): ClaimReadiness;

/**
 * Whether a game is worth checking for a proof, before its status and the
 * registry are read: it covers the withdrawal, and it was created after the
 * respected game type last changed.
 */
export declare function isCandidateGame(
  game: { createdAt: bigint | number; l2BlockNumber: bigint | number },
  rules: GameRules
): boolean;

/**
 * Whether a proof can go against a game and be claimed exactly its maturity
 * delay later: a candidate that has resolved for its proposal (the defender
 * won), and that the registry calls proper and respected.
 */
export declare function isEligibleGame(game: GameCheck, rules: GameRules): boolean;
