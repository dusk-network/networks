/**
 * About what native staking pays a year across the network, as a fraction
 * (0.235 is 23.5%): a simple rate, as rewards don't compound unless they're
 * claimed and staked again. `provisioners` is the node's
 * /on/node/provisioners reply. Null when nothing is staked.
 */
export declare function nativeRateEstimate(options: {
  provisioners: ReadonlyArray<{ amount?: number | string | bigint; eligibility?: number | bigint }>;
  tipHeight: number | bigint;
  /** 10 by default. */
  blockTimeSeconds?: number;
}): number | null;

/**
 * About what Sozu pays a year: native × (1 − Sozu's reward fee), the fee as
 * `readSozuStatus` gives it or as a fraction. Null without either.
 */
export declare function sozuRateEstimate(
  native: number | null,
  rewardFee:
    | { numerator: bigint | number | string; denominator: bigint | number | string }
    | number
    | null
): number | null;
