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

export declare const SOZU_FN: Readonly<{ STAKE: "sozu_stake"; UNSTAKE: "sozu_unstake" }>;

/** Gas for a wallet's own calls of the pool: the limit, and the floor to warn under. */
export declare const SOZU_GAS: Readonly<{
  sozu_stake: Readonly<{ limit: bigint; minimum: bigint }>;
  sozu_unstake: Readonly<{ limit: bigint; minimum: bigint }>;
}>;

/** `hub.contract(name)`'s argument for each name, in hex. */
export declare const HUB_NAME_ARGS: Readonly<{
  pool: string;
  relayer: string;
  "staked-dusk": string;
  substrate: string;
  vault: string;
}>;

export declare function encodeU64(value: bigint): Uint8Array;
export declare function parsePool(rate: unknown): SozuPool;
export declare function parseFeeRate(bytes: Uint8Array): SozuFeeRate;
export declare function sozuFee(amount: bigint, rate: SozuFeeRate): bigint;
export declare function feePercent(rate: SozuFeeRate, locale?: string): string;
export declare function stDuskFor(amount: bigint, pool: SozuPool | null): bigint | null;
export declare function sozuStake(
  amount: bigint,
  pool: SozuPool | null,
  depositFee?: SozuFeeRate | null
): { fee: bigint; ok: boolean; stDusk: bigint | null; worth: bigint };
export declare function sozuUnstakeAllowed(amount: bigint, balance: bigint): boolean;
export declare function leastSozuStake(pool: SozuPool | null, depositFee?: SozuFeeRate | null): bigint | null;
export declare function duskPerStDusk(pool: SozuPool | null): bigint | null;
export declare function readLux(value: unknown): bigint;
export declare function decodeContractId(bytes: Uint8Array): string | null;
export declare function decodeU64(bytes: Uint8Array): bigint;
export declare function decodeSwitch(bytes: Uint8Array): boolean;
export declare function sozuCall(
  poolId: string,
  fnName: "sozu_stake" | "sozu_unstake",
  amount: bigint
): { contractId: string; deposit: bigint; fnArgs: Uint8Array; fnName: string };
/** Where a status read starts: a network's `sozu` as it is, or the hub and the contracts known before it answers. */
export type SozuStart =
  | { hub: string; fallbacks: { pool?: string | null; stDusk?: string | null; substrate?: string | null } }
  | { hub: string; pool?: string | null; stDusk?: string | null; substrate?: string | null };

export declare function readSozuStatus(options: {
  read: SozuRead;
  contracts: SozuStart;
  account?: Uint8Array | null;
  named?: Map<string, SozuNamed>;
}): Promise<SozuStatus>;
