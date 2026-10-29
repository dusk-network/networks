/**
 * DuskEVM's bridge on Dusk, as the apps share it:
 * - what a call to its bridge or its Portal does, read from the call's
 *   arguments as they write them (`decodeBridgeCall`): a deposit's DuskEVM
 *   address and amount; the withdrawal a proof or a claim is for, whom it
 *   pays on Dusk and its hash, on the bridge's own route only. Anything that
 *   doesn't decode exactly reads as null. Synchronous, for an extension's
 *   service worker too;
 * - a deposit's arguments (`encodeDepositArgs`, `depositCall`), and the
 *   check that a call is sent as the bridge's route expects
 *   (`bridgeEnvelopeOk`);
 * - when a withdrawal can be claimed, worked out the way the Portal checks a
 *   claim: from the later of the proof's maturity
 *   (`proofMaturityDelaySeconds` after it was made) and its dispute game's
 *   finality (`disputeGameFinalityDelaySeconds` after the game resolved).
 *   Exact once the game has resolved; before that, the earliest it can be,
 *   from the game's clock (`maxClockDuration`). Pure: each app reads the
 *   game, the Portal and Dusk's latest block itself. And that date in words.
 *
 * Contract IDs and addresses come from the network's file.
 *
 * @example
 * ```js
 * import { bridgeEnvelopeOk, decodeBridgeCall, depositCall } from "@dusk/networks/duskevm";
 *
 * const call = decodeBridgeCall(net, { contractId, fnName, args }); // null for anything else
 * if (call?.kind === "deposit" && bridgeEnvelopeOk(call, { amount, deposit })) call.recipient; // "0x3E5B…a11d"
 * if (call?.kind === "claim") [call.amountWei, call.recipient, call.hash]; // 10n ** 18n, { kind: "account", account }, "0x8e2d…"
 * depositCall(net, { amountLux: 100_000_000n, to: "0x3E5B8223e638CB414BEF8CF95393460cA1C3a11d" }); // { contractId, deposit, fnArgs, fnName }
 * ```
 *
 * @example
 * ```js
 * import { claimFrom, claimReadiness, claimText } from "@dusk/networks/duskevm";
 * import { formatTime } from "@dusk/networks/format";
 *
 * const claim = claimFrom({
 *   provenAt: 46_877_440n, // the Portal's proof time
 *   game: { createdAt: 46_876_050n, resolvedAt: 0n, status: 0, maxClockDuration: 302_400n },
 *   portal: { proofMaturityDelaySeconds: 604_800n, disputeGameFinalityDelaySeconds: 302_400n },
 *   tip: { height: 4_704_959n, timestamp: 1_793_156_989n }, // Dusk's latest block
 * });
 * // { at: Date.UTC(2026, 10, 2, 3, 20, 39), exact: false, overdue: false }: "about Mon 2 Nov, 04:20 CET"
 * claimReadiness({ claim, portalAccepts: false, tip }); // { ready: false, readyAt: 1793589639n, … }
 * claimText(claim, (ms) => formatTime(ms)); // "Claim from about 2 Nov, 04:20 CET"
 * ```
 *
 * @module
 */

import type { Account, ContractId, EvmAddress, NetworkRef } from "./index.js";

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

/**
 * "Claim 7 days after you prove.", from the Portal's proof maturity delay,
 * in seconds.
 */
export declare function claimAfterProving(maturity: bigint | number): string;

/** "You can prove about 30 minutes after sending.", from how often outputs come, in seconds. */
export declare function provingAfterSending(prove: number): string;

/**
 * Before the proof: "Claim 7 days after you prove. You can prove about 30
 * minutes after sending.", from what the chain said, the Portal's maturity
 * delay and how often outputs come; "" until it has.
 */
export declare function beforeProofText(time: { maturity?: number; prove?: number } | null | undefined): string;

/**
 * After the proof: "Claim from 2 Nov, 04:24 CET", "Claim from about …"
 * while its game hasn't resolved, or, with its resolution late, "Waiting for
 * DuskEVM to settle this proof. Claim from … at the soonest."; "" without a
 * date. `when` writes the date.
 */
export declare function claimText(claim: Partial<ClaimDate> | null | undefined, when: (ms: number) => string): string;

/**
 * Before proving: "If you prove now, you can claim from 9 Nov, 03:20 CET",
 * or "from about …" while it's an estimate; "" without a date.
 */
export declare function proveNowText(claim: Partial<ClaimDate> | null | undefined, when: (ms: number) => string): string;

/** DuskEVM's contracts on Dusk the apps call and read, by what they do, as contract IDs. */
export type DuskEvmContracts = Readonly<{
  /** Deposits to DuskEVM go to its L1 standard bridge. */
  bridge: ContractId;
  /** Withdrawals are proved and claimed at its Optimism Portal, which pays the DUSK out. */
  portal: ContractId;
  /** The L1 cross-domain messenger a withdrawal is relayed through. */
  messenger: ContractId | null;
  /** The dispute game factory, which lists the games a proof goes against. */
  disputeGameFactory: ContractId | null;
  /** The anchor state registry, which says whether a game is proper and respected. */
  anchorStateRegistry: ContractId | null;
}>;

/**
 * The network's DuskEVM contracts on Dusk, from its file; null on a network
 * without DuskEVM's bridge and Portal. Throws a TypeError for a network
 * there's no file for.
 */
export declare function duskEvmContracts(net: NetworkRef): DuskEvmContracts | null;

/** Whether a contract, in hex with or without 0x, is the network's DuskEVM bridge or Portal. */
export declare function isBridgeContract(net: NetworkRef, contractId: unknown): boolean;

/**
 * The EVM address DuskEVM's contracts give a Dusk contract or account: the
 * last 20 bytes of the keccak-256 of the contract's ID, or of the account's
 * raw key, as the Portal keeps the proofs an account makes. With its
 * EIP-55 checksum. Throws a TypeError for anything else.
 */
export declare function evmAddressOf(contractIdOrAccount: string): EvmAddress;

/** The bridge's functions on Dusk: the bridge's deposit, and the Portal's proof and claims. */
export declare const BRIDGE_FUNCTIONS: Readonly<{
  deposit: "depositETHToWithValue";
  prove: "proveWithdrawalTransaction";
  claim: "finalizeWithdrawalTransaction";
  claimWithProofOf: "finalizeWithdrawalTransactionExternalProof";
}>;

/** Whom a withdrawal pays on Dusk: an account, or a contract, which gets the payload after its ID. */
export type DuskRecipient = { kind: "account"; account: Account } | { kind: "contract"; contractId: ContractId };

/** A deposit to DuskEVM, as its call's arguments say. */
export type DepositCall = {
  kind: "deposit";
  /** The DUSK it bridges, in lux; the call must send it as its deposit (`bridgeEnvelopeOk`). */
  amountLux: bigint;
  /** The DuskEVM address it pays. */
  recipient: EvmAddress;
  /** The gas it leaves its call on DuskEVM. */
  minGasLimit: number;
  /** The extra data it passes along, in bytes; the bridge sends none. */
  extraDataBytes: number;
};

/**
 * A DuskEVM withdrawal of DUSK, as DuskEVM recorded it, on the bridge's
 * route: from DuskEVM's messenger to Dusk's, relaying DuskEVM's bridge to
 * Dusk's, its amount the same in the withdrawal, the relay and the bridge's
 * message.
 */
export type WithdrawalFacts = {
  /** What it pays, in DuskEVM's 18 decimals. */
  amountWei: bigint;
  /** Whom it pays on Dusk. */
  recipient: DuskRecipient;
  /** The DuskEVM address that withdrew. */
  from: EvmAddress;
  /** Its target on Dusk: the network's L1 messenger, as DuskEVM names it. */
  target: EvmAddress;
  /** The gas its own call asks for, which a claim adds to its limit. */
  gasLimit: bigint;
  /** Its nonce, with its version on top: the same in its proof and its claim. */
  nonce: bigint;
  /** Its hash, which the Portal keys its proofs and its claim by. */
  hash: `0x${string}`;
};

/** A proof of a withdrawal: the withdrawal, the dispute game it goes against, and its proof's nodes. */
export type ProveCall = WithdrawalFacts & { kind: "prove"; disputeGameIndex: bigint; proofNodes: number };

/** A claim of a withdrawal; one made with another's proof names that proof's submitter. */
export type ClaimCall = WithdrawalFacts & { kind: "claim"; proofSubmitter?: EvmAddress };

/** What a call of DuskEVM's bridge or Portal does. */
export type BridgeCall = DepositCall | ProveCall | ClaimCall;

/**
 * What a call to the network's DuskEVM bridge or Portal does, from its
 * arguments (bytes, or hex with or without 0x); null for any other call, on
 * a network without DuskEVM, and for arguments that don't decode exactly as
 * the bridge and the Portal's data driver write them: every pointer in
 * bounds, and a withdrawal on the bridge's route, paying a Dusk account or
 * contract as Dusk's L1 bridge pays it out (a contract only whole lux, at
 * the address DuskEVM gives it; no one past a u64 of lux). `fnName` is
 * taken as given, as Dusk dispatches it. Throws a TypeError for a network
 * there's no file for.
 */
export declare function decodeBridgeCall(
  net: NetworkRef,
  call: { contractId?: unknown; fnName?: unknown; args?: unknown }
): BridgeCall | null;

/**
 * A withdrawal as DuskEVM's `MessagePassed` event gives it, read as the
 * bridge's, by the same rules: null for any other message, one Dusk's L1
 * bridge wouldn't pay out, or on a network without DuskEVM. Its numbers as
 * bigints, numbers or strings, its data as bytes or hex.
 */
export declare function decodeWithdrawal(
  net: NetworkRef,
  withdrawal: { nonce?: unknown; sender?: unknown; target?: unknown; value?: unknown; gasLimit?: unknown; data?: unknown }
): WithdrawalFacts | null;

/**
 * Whom a withdrawal's `extraData`, as `bridgeETHTo` and `finalizeBridgeETH`
 * carry it, pays on Dusk: an account (tag 2, version 1, kind 0, its raw
 * key) or a contract (tag 32, version 1, its ID, then a payload for it).
 * Null for anything else, a key that isn't one or a zero ID included.
 */
export declare function duskRecipientOf(extraData: unknown): DuskRecipient | null;

/**
 * Whether the transfer a bridge call rides on is the one the bridge's route
 * expects: no `amount`; a deposit sends its bridged amount as the
 * `deposit`, a proof or a claim none; and it pays no account but the
 * payer's own (no `to`, or one of `own`).
 */
export declare function bridgeEnvelopeOk(
  call: BridgeCall | null | undefined,
  envelope?: { amount?: unknown; deposit?: unknown; to?: unknown; own?: ReadonlyArray<string> }
): boolean;

/** The gas a deposit leaves its call on DuskEVM: the DuskEVM SDK's default, 200,000. */
export declare const DEPOSIT_MIN_GAS_LIMIT: number;

/** A deposit's amount, its DuskEVM recipient, and what it passes along. */
export type DepositInput = {
  /** The DUSK to bridge, in lux: more than 0, at most a u64. */
  amountLux: bigint | number | string;
  /** The DuskEVM address to pay; a mixed-case one must carry its EIP-55 checksum. */
  to: string;
  /** The gas it leaves its call on DuskEVM; `DEPOSIT_MIN_GAS_LIMIT` by default. */
  minGasLimit?: bigint | number;
  /** None by default. */
  extraData?: Uint8Array | ArrayLike<number>;
};

/**
 * `depositETHToWithValue(u64, [u8; 20], u32, Vec<u8>)`'s arguments, rkyv as
 * the bridge's data driver writes them. Throws a RangeError for an amount
 * or a gas limit out of range, a TypeError for a recipient that isn't an
 * EVM address.
 */
export declare function encodeDepositArgs(deposit: DepositInput): Uint8Array;

/**
 * A deposit to DuskEVM as a transaction carries it: the network's bridge,
 * the function, the arguments, and the amount sent along as its deposit.
 * Null on a network without DuskEVM.
 */
export declare function depositCall(
  net: NetworkRef,
  deposit: DepositInput
): { contractId: ContractId; deposit: bigint; fnArgs: Uint8Array; fnName: "depositETHToWithValue" } | null;
