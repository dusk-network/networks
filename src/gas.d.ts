/**
 * Gas for the Dusk apps' own transactions, at the node's price: each
 * operation's limit, the floor to warn under while typing, and what it
 * usually spends, for a quote. A failed transaction is charged its whole
 * limit, so each operation has its own. Sozu's are `SOZU_GAS`, here too.
 *
 * @example
 * ```js
 * import { DEPOSIT_GAS, TRANSFER_GAS, withdrawalGasLimit } from "@dusk/networks/gas";
 *
 * TRANSFER_GAS.limit; // 2_500_000n: a public transfer
 * DEPOSIT_GAS.minimum; // 2_500_000n: warn under it while typing
 * withdrawalGasLimit(519_542n); // 51_000_000n: a proof or a claim of that withdrawal
 * ```
 *
 * @module
 */

/** An operation's gas: its limit, the floor to warn under while typing, and what it usually spends. */
export type OperationGas = Readonly<{ limit: bigint; minimum: bigint; typical: bigint }>;

/** Gas for a wallet's own calls of Sozu's pool, as `/sozu` gives it. */
export { SOZU_GAS } from "./sozu.js";

/** A public transfer: a 2.5M limit, a 2M floor, 1.85M spent. */
export declare const TRANSFER_GAS: OperationGas;

/** A deposit to DuskEVM: a 5M limit, a 2.5M floor, 2M spent. */
export declare const DEPOSIT_GAS: OperationGas;

/**
 * A DuskEVM withdrawal's proof or claim, which has no gas editor: a 50M
 * limit before the withdrawal's own gas is added (`withdrawalGasLimit`),
 * 2.3M spent.
 */
export declare const WITHDRAWAL_GAS: Readonly<{ limit: bigint; typical: bigint }>;

/** The most gas a withdrawal's own call asks for before it's known: 1M. */
export declare const WITHDRAWAL_RELAY_GAS: bigint;

/**
 * The limit to prove or to claim a withdrawal with, one for both steps:
 * 50M, and the gas the withdrawal's own call asks for, at least 1M. Throws
 * a RangeError for a negative gas. An app refuses it over its own upper
 * bound: less gas could leave the withdrawal's call short.
 */
export declare function withdrawalGasLimit(withdrawalGas?: bigint | number | string): bigint;
