/** DUSK minted per block, in lux, up to and including each `lastHeight`. */
export declare const EMISSION_SCHEDULE: ReadonlyArray<Readonly<{ lastHeight: number; lux: bigint }>>;

/** The share of a block's reward that reaches provisioners: 0.78. */
export declare const PROVISIONER_SHARE: number;

/** Seconds per block: 10. */
export declare const BLOCK_TIME_SECONDS: number;

/** The least stake consensus counts, in lux: 1,000 DUSK. */
export declare const MINIMUM_STAKE_LUX: bigint;

/** A provisioner as /on/node/provisioners gives it; only these fields are read. */
export type Provisioner = { amount?: number | string | bigint; eligibility?: number | bigint };

/** The DUSK a block at `height` mints, in lux, without its fees. */
export declare function emissionAt(height: number | bigint): bigint;

/** The stake consensus counts at the tip, in lux. */
export declare function eligibleStake(provisioners: ReadonlyArray<Provisioner>, tipHeight: number | bigint): bigint;

/** About what native staking pays a year across the network, as a fraction; null when nothing is staked. */
export declare function nativeRateEstimate(options: {
  provisioners: ReadonlyArray<Provisioner>;
  tipHeight: number | bigint;
  blockTimeSeconds?: number;
}): number | null;

/** native × (1 − Sozu's reward fee), as a fraction; null without either. */
export declare function sozuRateEstimate(
  native: number | null,
  rewardFee:
    | { numerator: bigint | number | string; denominator: bigint | number | string }
    | number
    | null
): number | null;
