/**
 * Sozu's liquid staking rules as its contracts (v1.0.0) apply them, and its
 * reads in one query through the app's own batcher. Amounts are lux, as
 * bigints.
 *
 * @example
 * ```js
 * import { SOZU_FN, readSozuStatus, sozuCall, sozuStake } from "@dusk/networks/sozu";
 *
 * const status = await readSozuStatus({ read, contracts: net.sozu, account });
 * sozuStake(1_000_000_000n, status.pool, status.fees?.deposit); // { fee, worth, stDusk, ok }
 * sozuCall(status.contracts.pool, SOZU_FN.STAKE, 1_000_000_000n); // { contractId, deposit, fnArgs, fnName }
 * ```
 *
 * @module
 */

/** The pool's rate: the DUSK staked through it over the stDUSK there is. */
export type SozuPool = { stake: bigint; supply: bigint };

/** A fee rate as Sozu's substrate gives it: the numerator over the denominator. */
export type SozuFeeRate = { numerator: bigint; denominator: bigint };

/** Sozu's fees: on each deposit, and on the rewards. */
export type SozuFees = { deposit: SozuFeeRate; reward: SozuFeeRate };

/**
 * Sozu's switches: maintenance stops deposits; while it synchronizes, a
 * stake or an unstake can fail. Each is null when it couldn't be read.
 */
export type SozuFlags = { maintenance: boolean | null; synchronization: boolean | null };

/** A contract read through the app's batcher: the reply's bytes, or a rejection. */
export type SozuRead = (
  contractId: string,
  fnName: string,
  args: Uint8Array
) => Promise<Uint8Array> | Uint8Array;

/** The contracts the figures are read from, as the hub named them; null where none is known. */
export type SozuContractIds = {
  pool: string | null;
  stDusk: string | null;
  substrate: string | null;
};

/** What a hub named last, and which of those it named itself. */
export type SozuNamed = {
  ids: SozuContractIds;
  fromHub: { pool: boolean; stDusk: boolean; substrate: boolean };
};

/** What an account has with Sozu. Each figure is null when it couldn't be read; `error` says why. */
export type SozuStatus = {
  contracts: { hub: string } & SozuContractIds;
  /** "hub" when the hub named all three contracts, else "fallback". */
  source: "hub" | "fallback";
  pool: SozuPool | null;
  /** Null when no account was given; each balance null when it couldn't be read. */
  position: {
    /** The DUSK the account has with Sozu, as the pool counts it: the Max to unstake. */
    balance: bigint | null;
    /** The account's stDUSK; unknown while the stDUSK token isn't. */
    stDusk: bigint | null;
  } | null;
  fees: SozuFees | null;
  flags: SozuFlags;
  error: string;
};

/** Where a status read starts: a network's `sozu` as it is, or the hub and the contracts known before it answers. */
export type SozuStart =
  | { hub: string; fallbacks: { pool?: string | null; stDusk?: string | null; substrate?: string | null } }
  | { hub: string; pool?: string | null; stDusk?: string | null; substrate?: string | null };

/** The pool's functions a wallet calls. */
export declare const SOZU_FN: Readonly<{ STAKE: "sozu_stake"; UNSTAKE: "sozu_unstake" }>;

/**
 * Gas for a wallet's own calls of the pool, at the node's price: the limit,
 * and the floor to warn under while typing. A failed call is charged its
 * whole limit.
 */
export declare const SOZU_GAS: Readonly<{
  sozu_stake: Readonly<{ limit: bigint; minimum: bigint }>;
  sozu_unstake: Readonly<{ limit: bigint; minimum: bigint }>;
}>;

/** `hub.contract(name)`'s argument for each name the hub keeps, in hex: the name as an rkyv 0.7 string. */
export declare const HUB_NAME_ARGS: Readonly<{
  pool: string;
  relayer: string;
  "staked-dusk": string;
  substrate: string;
  vault: string;
}>;

/** An amount as Sozu's pool takes it: a u64, in 8 bytes, little-endian. Throws past a u64. */
export declare function encodeU64(value: bigint): Uint8Array;

/** The pool's rate from `exchange_rate`'s `{ numerator, denominator }`, as numbers, strings or bigints. */
export declare function parsePool(rate: unknown): SozuPool;

/** A ratio as Sozu's contracts give it: two little-endian u64s, numerator first. Throws on any other length. */
export declare function parseFeeRate(bytes: Uint8Array): SozuFeeRate;

/** The fee Sozu takes from `amount` at `rate`, rounded up as its pool rounds it. */
export declare function sozuFee(amount: bigint, rate: SozuFeeRate): bigint;

/** A fee rate as a percentage: "0.25%", "15%". */
export declare function feePercent(rate: SozuFeeRate, locale?: string): string;

/**
 * About how much stDUSK `amount` gets now before any fee, rounded down: 1:1
 * while the pool is empty, as its contract mints then; null without a rate.
 */
export declare function stDuskFor(amount: bigint, pool: SozuPool | null): bigint | null;

/**
 * A stake of `amount` as the pool takes it: the deposit fee, rounded up; what
 * is left, which the stDUSK is worth now; and the stDUSK, rounded down. It
 * goes ahead (`ok`) only when that is at least 1 lux of stDUSK: anything
 * less, the pool refuses, and the call is charged its whole gas limit.
 */
export declare function sozuStake(
  amount: bigint,
  pool: SozuPool | null,
  depositFee?: SozuFeeRate | null
): { fee: bigint; ok: boolean; stDusk: bigint | null; worth: bigint };

/** Whether an unstake goes ahead: more than 0, and no more than `pool.balance_of` the account. It pays out in the same transaction, with no fee. */
export declare function sozuUnstakeAllowed(amount: bigint, balance: bigint): boolean;

/** The least stake that gets any stDUSK at the rate now, after the deposit fee; null when none can. */
export declare function leastSozuStake(pool: SozuPool | null, depositFee?: SozuFeeRate | null): bigint | null;

/** What one stDUSK is worth now, in lux; null without a rate. */
export declare function duskPerStDusk(pool: SozuPool | null): bigint | null;

/** An amount the pool's reads give, as lux: 0 for anything that isn't one. */
export declare function readLux(value: unknown): bigint;

/** `hub.contract`'s reply, an `Option<ContractId>`: the ID in hex, or null when the hub names none. */
export declare function decodeContractId(bytes: Uint8Array): string | null;

/** A u64 reply, little-endian: a balance. */
export declare function decodeU64(bytes: Uint8Array): bigint;

/** Whether a switch is on: exactly one byte, 0 or 1. Anything else throws, so it reads as unknown. */
export declare function decodeSwitch(bytes: Uint8Array): boolean;

/**
 * A stake or an unstake as a transaction carries it, sent from a public
 * account: a stake sends the amount along as its deposit, an unstake
 * nothing; the argument is the amount as a u64.
 */
export declare function sozuCall(
  poolId: string,
  fnName: "sozu_stake" | "sozu_unstake",
  amount: bigint
): { contractId: string; deposit: bigint; fnArgs: Uint8Array; fnName: string };

/**
 * Reads what an account has with Sozu, in one query a refresh: the contracts
 * the hub names now, the pool's rate, the account's balances, Sozu's fees
 * and its two switches. The figures come from the contracts the hub named
 * last, and again from new ones only when it names others. `account` is
 * `balance_of`'s argument, as the pool's data driver encodes the account.
 */
export declare function readSozuStatus(options: {
  read: SozuRead;
  contracts: SozuStart;
  account?: Uint8Array | null;
  named?: Map<string, SozuNamed>;
}): Promise<SozuStatus>;
