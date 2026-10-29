/* @ts-self-types="./gas.d.ts" */
/**
 * Gas for the apps' own transactions, at the node's price. Only the gas a
 * transaction uses is charged, but a failed one, out of gas included, is
 * charged its whole limit, so each operation has its own.
 *
 * @module
 */

export { SOZU_GAS } from "./sozu.js";

/**
 * A public transfer: 1.81M to 1.87M gas under Rusk 1.7.1, memos included,
 * so 2.5M, and a floor 5% over what they spend.
 */
export const TRANSFER_GAS = Object.freeze({ limit: 2_500_000n, minimum: 2_000_000n, typical: 1_850_000n });

/** A deposit to DuskEVM: about 1.99M gas (1,986,599 on testnet, 25 Oct 2026). */
export const DEPOSIT_GAS = Object.freeze({ limit: 5_000_000n, minimum: 2_500_000n, typical: 2_000_000n });

/**
 * A DuskEVM withdrawal's proof or claim: about 2.3M gas (a proof: 2,209,505).
 * The claim hands the Portal's remaining gas to the withdrawal's own call,
 * and consumes the withdrawal even when that call runs out, so both steps
 * get a far larger limit, with the withdrawal's own gas on top.
 */
export const WITHDRAWAL_GAS = Object.freeze({ limit: 50_000_000n, typical: 2_300_000n });

/**
 * The most gas a withdrawal's own call asks for, before it's known: the
 * bridge's withdrawals forward a 200,000 minimum, which DuskEVM's messenger
 * raises to about 520,000 (519,542 for a 10 DUSK testnet withdrawal).
 */
export const WITHDRAWAL_RELAY_GAS = 1_000_000n;

/**
 * @param {bigint | number | string} [withdrawalGas]
 * @returns {bigint}
 */
export function withdrawalGasLimit(withdrawalGas = 0n) {
  const own = BigInt(withdrawalGas);

  if (own < 0n) {
    throw new RangeError("A withdrawal's gas isn't negative");
  }

  return WITHDRAWAL_GAS.limit + (own > WITHDRAWAL_RELAY_GAS ? own : WITHDRAWAL_RELAY_GAS);
}
