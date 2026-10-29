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
 * And what a call to DuskEVM's bridge on Dusk does, read from its arguments
 * the way the bridge and the Portal's data driver write them: a deposit's
 * DuskEVM address and amount, and the withdrawal a proof or a claim is for,
 * on the bridge's route only. Synchronous and pure, for an extension's
 * service worker too.
 *
 * @module
 */

import { accountToRawKey, rawKeyToAccount } from "./account.js";
import { RAW_KEY_BYTES } from "./bls.js";
import { aboutWords, durationWords, formatEvmAddress } from "./format.js";
import { fromHex, toHex } from "./hex.js";
import { keccak256 } from "./keccak.js";
import { networkOf } from "./networks.js";

/** @typedef {import("./duskevm.js").DuskTip} DuskTip */
/** @typedef {import("./duskevm.js").ContractClock} ContractClock */
/** @typedef {import("./duskevm.js").ClaimDate} ClaimDate */
/** @typedef {import("./duskevm.js").BridgeCall} BridgeCall */
/** @typedef {import("./duskevm.js").DepositCall} DepositCall */
/** @typedef {import("./duskevm.js").DuskEvmContracts} DuskEvmContracts */
/** @typedef {import("./duskevm.js").DuskRecipient} DuskRecipient */
/** @typedef {import("./duskevm.js").WithdrawalFacts} WithdrawalFacts */
/** @typedef {import("./index.js").Network} Network */
/** @typedef {import("./index.js").NetworkRef} NetworkRef */

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

// ---- A claim date in words ------------------------------------------------

/**
 * @param {bigint | number} maturity The Portal's proof maturity delay, in seconds
 * @returns {string}
 */
export const claimAfterProving = (maturity) => `Claim ${durationWords(maturity)} after you prove.`;

/**
 * @param {number} prove How often outputs come, in seconds
 * @returns {string}
 */
export const provingAfterSending = (prove) => `You can prove ${aboutWords(prove)} after sending.`;

/**
 * @param {{ maturity?: number, prove?: number } | null | undefined} time
 * @returns {string}
 */
export function beforeProofText(time) {
  if (!time?.maturity) {
    return "";
  }

  return time.prove
    ? `${claimAfterProving(time.maturity)} ${provingAfterSending(time.prove)}`
    : claimAfterProving(time.maturity);
}

/**
 * @param {Partial<ClaimDate> | null | undefined} claim
 * @param {(ms: number) => string} when
 * @returns {string}
 */
export function claimText(claim, when) {
  if (!claim?.at) {
    return "";
  }

  if (claim.overdue) {
    return `Waiting for DuskEVM to settle this proof. Claim from ${when(claim.at)} at the soonest.`;
  }

  return `Claim from ${claim.exact ? "" : "about "}${when(claim.at)}`;
}

/**
 * @param {Partial<ClaimDate> | null | undefined} claim
 * @param {(ms: number) => string} when
 * @returns {string}
 */
export function proveNowText(claim, when) {
  if (!claim?.at) {
    return "";
  }

  return `If you prove now, you can claim from ${claim.exact ? "" : "about "}${when(claim.at)}`;
}

// ---- DuskEVM's contracts on Dusk -----------------------------------------

/** @type {WeakMap<object, DuskEvmContracts | null>} */
const contractsCache = new WeakMap();

/**
 * @param {NetworkRef} net
 * @returns {DuskEvmContracts | null}
 */
export function duskEvmContracts(net) {
  const network = networkOf(net);

  if (contractsCache.has(network)) {
    return contractsCache.get(network) ?? null;
  }

  const contracts = network.duskEvm?.contracts ?? {};
  /** @param {string} name */
  const id = (name) => (Object.hasOwn(contracts, name) ? contracts[name].contractId : null);
  const bridge = id("l1_standard_bridge");
  const portal = id("optimism_portal");
  const found =
    bridge && portal
      ? Object.freeze({
          anchorStateRegistry: id("anchor_state_registry"),
          bridge,
          disputeGameFactory: id("dispute_game_factory"),
          messenger: id("l1_cross_domain_messenger"),
          portal,
        })
      : null;

  contractsCache.set(network, found);

  return found;
}

/**
 * @param {unknown} id
 * @returns {string | null}
 */
const contractIdOf = (id) => {
  const hex = typeof id === "string" ? id.trim().toLowerCase().replace(/^0x/, "") : "";

  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
};

/**
 * @param {NetworkRef} net
 * @param {unknown} contractId
 * @returns {boolean}
 */
export function isBridgeContract(net, contractId) {
  const contracts = duskEvmContracts(net);
  const id = contractIdOf(contractId);

  return Boolean(contracts && id && (id === contracts.bridge || id === contracts.portal));
}

/**
 * @param {string} contractIdOrAccount
 * @returns {`0x${string}`}
 */
export function evmAddressOf(contractIdOrAccount) {
  const id = contractIdOf(contractIdOrAccount);
  const key = id ? fromHex(id) : accountToRawKey(contractIdOrAccount);

  if (!key) {
    throw new TypeError("Not a contract ID or a Dusk account");
  }

  return formatEvmAddress(`0x${toHex(keccak256(key).subarray(12))}`);
}

// ---- Calls of the bridge and the Portal ----------------------------------

/** The bridge's functions on Dusk: the bridge's deposit, and the Portal's proof and claims. */
export const BRIDGE_FUNCTIONS = Object.freeze({
  claim: "finalizeWithdrawalTransaction",
  claimWithProofOf: "finalizeWithdrawalTransactionExternalProof",
  deposit: "depositETHToWithValue",
  prove: "proveWithdrawalTransaction",
});

// Archived sizes, in bytes. The root object sits at the end of the buffer.
/** u64 amount, [u8; 20] to, u32 min gas, Vec<u8> extra data. */
const DEPOSIT_ROOT = 40;
/** Nonce, value and gas limit (32 bytes each, big-endian), Vec<u8> data, sender and target (20 each). */
const WITHDRAWAL = 144;
/** The output root proof (128), the game's index (32), the withdrawal, and the proof, a Vec<Vec<u8>>. */
const PROVE_ROOT = 312;

// What DuskEVM's bridge relays: L1CrossDomainMessenger.relayMessage, with
// L1StandardBridge.finalizeBridgeETH as its message.
const RELAY_MESSAGE = "d764ad0b";
const FINALIZE_BRIDGE_ETH = "1635f5fd";

const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = (1n << 32n) - 1n;
const U256 = 1n << 256n;

/** DuskEVM counts 18 decimals, Dusk 9. */
const WEI_PER_LUX = 1_000_000_000n;

/** @returns {never} */
function fail() {
  throw new Error("Not the bridge's call");
}

/**
 * Bytes, or hex with or without 0x; null for anything else.
 *
 * @param {unknown} value
 * @returns {Uint8Array | null}
 */
function bytesOf(value) {
  if (value instanceof Uint8Array) {
    return value;
  }

  const hex = typeof value === "string" ? value.trim().replace(/^0x/i, "") : null;

  return hex !== null && /^(?:[0-9a-fA-F]{2})*$/.test(hex) ? fromHex(hex) : null;
}

/**
 * @param {Uint8Array} bytes
 * @param {number} at
 * @param {number} length
 */
function uintLe(bytes, at, length) {
  let out = 0n;

  for (let i = length - 1; i >= 0; i--) out = (out << 8n) | BigInt(bytes[at + i]);

  return out;
}

/**
 * @param {Uint8Array} bytes
 * @param {number} at
 * @param {number} length
 */
function uintBe(bytes, at, length) {
  let out = 0n;

  for (let i = 0; i < length; i++) out = (out << 8n) | BigInt(bytes[at + i]);

  return out;
}

/**
 * An archived Vec<T> at `at`: a relative pointer and a length. Its items
 * must lie before `end` (the root), where the serializer put them.
 *
 * @param {Uint8Array} bytes
 * @param {number} at
 * @param {number} end
 * @param {number} [itemSize]
 */
function vecAt(bytes, at, end, itemSize = 1) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = at + view.getInt32(at, true);
  const length = view.getUint32(at + 4, true);

  if (start < 0 || start + length * itemSize > end) fail();

  return { length, start };
}

/**
 * @param {Uint8Array} bytes
 * @param {number} at
 * @param {number} end
 */
function bytesAt(bytes, at, end) {
  const { length, start } = vecAt(bytes, at, end);

  return bytes.subarray(start, start + length);
}

/** @param {Uint8Array} bytes20 */
const checksummed = (bytes20) => formatEvmAddress(`0x${toHex(bytes20)}`);

/**
 * A call's ABI arguments by type: "uint" (a word), "address" (a word whose
 * top 12 bytes are zero) and "bytes" (a word pointing at a length and the
 * bytes).
 *
 * @param {Uint8Array} data
 * @param {string} selector
 * @param {("address" | "bytes" | "uint")[]} types
 * @returns {(bigint | Uint8Array)[]}
 */
function abiCall(data, selector, types) {
  if (data.length < 4 + 32 * types.length || toHex(data.subarray(0, 4)) !== selector) fail();

  const body = data.subarray(4);

  return types.map((type, i) => {
    const word = body.subarray(32 * i, 32 * i + 32);

    if (type === "uint") return uintBe(word, 0, 32);

    if (type === "address") {
      if (word.subarray(0, 12).some((b) => b !== 0)) fail();

      return word.subarray(12);
    }

    const offset = uintBe(word, 0, 32);

    if (offset < BigInt(32 * types.length) || offset + 32n > BigInt(body.length)) fail();

    const at = Number(offset);
    const length = uintBe(body, at, 32);

    if (BigInt(at) + 32n + length > BigInt(body.length)) fail();

    return body.subarray(at + 32, at + 32 + Number(length));
  });
}

/**
 * @param {Uint8Array} extraData
 * @returns {DuskRecipient | null}
 */
function recipientOf(extraData) {
  const b = extraData;

  if (b.length === 3 + RAW_KEY_BYTES && b[0] === 2 && b[1] === 1 && b[2] === 0) {
    const account = rawKeyToAccount(b.subarray(3));

    return account ? { account, kind: "account" } : null;
  }

  if (b.length >= 34 && b[0] === 32 && b[1] === 1) {
    const contractId = toHex(b.subarray(2, 34));

    return /^0+$/.test(contractId) ? null : { contractId, kind: "contract" };
  }

  return null;
}

/**
 * @param {unknown} extraData
 * @returns {DuskRecipient | null}
 */
export function duskRecipientOf(extraData) {
  const bytes = bytesOf(extraData);

  return bytes ? recipientOf(bytes) : null;
}

/**
 * @typedef {{ l1Bridge: string, l1Messenger: string, l2Bridge: string, l2Messenger: string }} WithdrawalRoute
 *   As lower-case hex without 0x.
 */

/**
 * The route a DUSK withdrawal takes, from the network's file: DuskEVM's
 * messenger sends it to Dusk's, relaying DuskEVM's bridge to Dusk's. The
 * DuskEVM side are OP-stack predeploys; the Dusk side are the EVM addresses
 * DuskEVM gives Dusk's contracts (L2CrossDomainMessenger.otherMessenger,
 * L2StandardBridge.otherBridge). Null without all four.
 *
 * @param {Network} network
 * @returns {WithdrawalRoute | null}
 */
function withdrawalRoute(network) {
  const evm = network.duskEvm;

  if (!evm) {
    return null;
  }

  /** @param {unknown} address */
  const hex = (address) => (typeof address === "string" ? address.toLowerCase().replace(/^0x/, "") : "");
  /** @param {string} name */
  const ours = (name) => (Object.hasOwn(evm.contracts, name) ? evm.contracts[name].evmAddress : null);
  const route = {
    l1Bridge: hex(ours("l1_standard_bridge")),
    l1Messenger: hex(ours("l1_cross_domain_messenger")),
    l2Bridge: hex(evm.predeploys.l2StandardBridge),
    l2Messenger: hex(evm.predeploys.l2CrossDomainMessenger),
  };

  return Object.values(route).every((address) => /^[0-9a-f]{40}$/.test(address)) ? route : null;
}

/**
 * @typedef {{ data: Uint8Array, gasLimit: bigint, nonce: bigint, sender: string, target: string, value: bigint }} L2Withdrawal
 *   As DuskEVM recorded it; `sender` and `target` lower-case hex without 0x.
 */

/**
 * The withdrawal's hash, which the Portal keys its proofs and its claim by:
 * keccak-256 of the ABI encoding of (nonce, sender, target, value, gas
 * limit, data).
 *
 * @param {L2Withdrawal} withdrawal
 * @returns {`0x${string}`}
 */
function withdrawalHash({ data, gasLimit, nonce, sender, target, value }) {
  const out = new Uint8Array(32 * 7 + 32 * Math.ceil(data.length / 32));
  /**
   * @param {number} at
   * @param {bigint} n
   */
  const word = (at, n) => {
    let rest = n;

    for (let i = 31; i >= 0; i--) {
      out[at + i] = Number(rest & 0xffn);
      rest >>= 8n;
    }
  };

  word(0, nonce);
  out.set(fromHex(sender), 44);
  out.set(fromHex(target), 76);
  word(96, value);
  word(128, gasLimit);
  word(160, 192n);
  word(192, BigInt(data.length));
  out.set(data, 224);

  return `0x${toHex(keccak256(out))}`;
}

/**
 * A withdrawal on the bridge's route, from messenger to messenger relaying
 * bridge to bridge, whose amount is the same in the withdrawal, the relay
 * and the bridge's message, and whose recipient is a Dusk account or
 * contract, paid as Dusk's L1 bridge pays it out: at most a u64 of lux, and
 * a contract only whole lux, at the address DuskEVM gives it (`to`).
 * Anything else fails.
 *
 * @param {L2Withdrawal} withdrawal
 * @param {WithdrawalRoute | null} route
 * @returns {WithdrawalFacts}
 */
function withdrawalFacts(withdrawal, route) {
  if (!route || withdrawal.sender !== route.l2Messenger || withdrawal.target !== route.l1Messenger) fail();

  const [, relaySender, relayTarget, relayValue, , message] = abiCall(withdrawal.data, RELAY_MESSAGE, [
    "uint",
    "address",
    "address",
    "uint",
    "uint",
    "bytes",
  ]);

  if (
    toHex(/** @type {Uint8Array} */ (relaySender)) !== route.l2Bridge ||
    toHex(/** @type {Uint8Array} */ (relayTarget)) !== route.l1Bridge
  ) {
    fail();
  }

  const [from, to, amountWei, extraData] = abiCall(/** @type {Uint8Array} */ (message), FINALIZE_BRIDGE_ETH, [
    "address",
    "address",
    "uint",
    "bytes",
  ]);

  if (withdrawal.value !== relayValue || relayValue !== amountWei) fail();

  const recipient = recipientOf(/** @type {Uint8Array} */ (extraData)) ?? fail();

  // Dusk's L1 bridge refuses a payout past a u64 of lux, an account's
  // (it keeps the dust past whole lux) and a contract's (it takes only whole
  // lux, sent to the address DuskEVM gives the contract).
  if (withdrawal.value / WEI_PER_LUX > U64_MAX) fail();

  if (
    recipient.kind === "contract" &&
    (withdrawal.value % WEI_PER_LUX !== 0n ||
      toHex(/** @type {Uint8Array} */ (to)) !== toHex(keccak256(fromHex(recipient.contractId)).subarray(12)))
  ) {
    fail();
  }

  return {
    amountWei: withdrawal.value,
    from: checksummed(/** @type {Uint8Array} */ (from)),
    gasLimit: withdrawal.gasLimit,
    hash: withdrawalHash(withdrawal),
    nonce: withdrawal.nonce,
    recipient,
    target: formatEvmAddress(`0x${withdrawal.target}`),
  };
}

/**
 * The withdrawal archived at `at`, its data before `end`.
 *
 * @param {Uint8Array} args
 * @param {number} at
 * @param {number} end
 * @returns {L2Withdrawal}
 */
const archivedWithdrawal = (args, at, end) => ({
  data: bytesAt(args, at + 96, end),
  gasLimit: uintBe(args, at + 64, 32),
  nonce: uintBe(args, at, 32),
  sender: toHex(args.subarray(at + 104, at + 124)),
  target: toHex(args.subarray(at + 124, at + 144)),
  value: uintBe(args, at + 32, 32),
});

/**
 * @param {Uint8Array} args
 * @returns {DepositCall}
 */
function decodeDeposit(args) {
  const root = args.length - DEPOSIT_ROOT;

  if (root < 0 || root % 8 !== 0) fail();

  return {
    amountLux: uintLe(args, root, 8),
    extraDataBytes: vecAt(args, root + 32, root).length,
    kind: "deposit",
    minGasLimit: Number(uintLe(args, root + 28, 4)),
    recipient: checksummed(args.subarray(root + 8, root + 28)),
  };
}

/**
 * @param {Uint8Array} args
 * @param {WithdrawalRoute | null} route
 * @returns {BridgeCall}
 */
function decodeProve(args, route) {
  const root = args.length - PROVE_ROOT;

  if (root < 0 || root % 4 !== 0) fail();

  // The proof's nodes: each a Vec<u8> before the root.
  const proof = vecAt(args, root + 304, root, 8);

  for (let i = 0; i < proof.length; i++) vecAt(args, proof.start + 8 * i, root);

  return {
    kind: "prove",
    ...withdrawalFacts(archivedWithdrawal(args, root + 160, root), route),
    disputeGameIndex: uintBe(args, root + 128, 32),
    proofNodes: proof.length,
  };
}

/**
 * A claim; one made with someone else's proof has its submitter last.
 *
 * @param {Uint8Array} args
 * @param {boolean} withProofOf
 * @param {WithdrawalRoute | null} route
 * @returns {BridgeCall}
 */
function decodeClaim(args, withProofOf, route) {
  const root = args.length - WITHDRAWAL - (withProofOf ? 20 : 0);

  if (root < 0 || root % 4 !== 0) fail();

  const facts = withdrawalFacts(archivedWithdrawal(args, root, root), route);

  return withProofOf
    ? { kind: "claim", ...facts, proofSubmitter: checksummed(args.subarray(root + WITHDRAWAL, root + WITHDRAWAL + 20)) }
    : { kind: "claim", ...facts };
}

/**
 * @param {NetworkRef} net
 * @param {{ contractId?: unknown, fnName?: unknown, args?: unknown }} call
 * @returns {BridgeCall | null}
 */
export function decodeBridgeCall(net, call) {
  const network = networkOf(net);
  const contracts = duskEvmContracts(network);
  const id = contractIdOf(call?.contractId);
  const args = bytesOf(call?.args);
  // Dusk calls a function by its exact name: " depositETHToWithValue " is another.
  const fn = call?.fnName;

  if (!contracts || !id || !args) {
    return null;
  }

  try {
    if (id === contracts.bridge) {
      return fn === BRIDGE_FUNCTIONS.deposit ? decodeDeposit(args) : null;
    }

    if (id === contracts.portal) {
      const route = withdrawalRoute(network);

      if (fn === BRIDGE_FUNCTIONS.prove) return decodeProve(args, route);
      if (fn === BRIDGE_FUNCTIONS.claim) return decodeClaim(args, false, route);
      if (fn === BRIDGE_FUNCTIONS.claimWithProofOf) return decodeClaim(args, true, route);
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * @param {unknown} value
 * @returns {bigint}
 */
function u256(value) {
  const n =
    typeof value === "bigint"
      ? value
      : (typeof value === "number" && Number.isSafeInteger(value)) ||
          (typeof value === "string" && /^\s*(?:\d+|0x[0-9a-fA-F]+)\s*$/.test(value))
        ? BigInt(/** @type {number | string} */ (value))
        : -1n;

  return n >= 0n && n < U256 ? n : fail();
}

/**
 * @param {unknown} address
 * @returns {string}
 */
const addressOf = (address) =>
  typeof address === "string" && /^0x[0-9a-fA-F]{40}$/.test(address.trim())
    ? address.trim().slice(2).toLowerCase()
    : fail();

/**
 * @param {NetworkRef} net
 * @param {{ nonce?: unknown, sender?: unknown, target?: unknown, value?: unknown, gasLimit?: unknown, data?: unknown }} withdrawal
 * @returns {WithdrawalFacts | null}
 */
export function decodeWithdrawal(net, withdrawal) {
  const route = withdrawalRoute(networkOf(net));

  try {
    return withdrawalFacts(
      {
        data: bytesOf(withdrawal?.data) ?? fail(),
        gasLimit: u256(withdrawal?.gasLimit),
        nonce: u256(withdrawal?.nonce),
        sender: addressOf(withdrawal?.sender),
        target: addressOf(withdrawal?.target),
        value: u256(withdrawal?.value),
      },
      route
    );
  } catch {
    return null;
  }
}

/**
 * Lux as the envelope gives them: none is 0, and anything but a whole
 * number reads as -1, which matches nothing.
 *
 * @param {unknown} value
 */
function envelopeLux(value) {
  try {
    return BigInt(String(value ?? "").trim() || "0");
  } catch {
    return -1n;
  }
}

/**
 * @param {BridgeCall | null | undefined} call
 * @param {{ amount?: unknown, deposit?: unknown, to?: unknown, own?: ReadonlyArray<string> }} [envelope]
 * @returns {boolean}
 */
export function bridgeEnvelopeOk(call, { amount, deposit, own = [], to } = {}) {
  if (!call || envelopeLux(amount) !== 0n) {
    return false;
  }

  const sent = envelopeLux(deposit);

  if (call.kind === "deposit" ? sent !== call.amountLux : sent !== 0n) {
    return false;
  }

  const recipient = String(to ?? "").trim();

  return !recipient || own.includes(recipient);
}

// ---- A deposit's arguments ------------------------------------------------

/** The gas a deposit leaves its call on DuskEVM: the DuskEVM SDK's default, 200,000, as OP Stack bridges use. */
export const DEPOSIT_MIN_GAS_LIMIT = 200_000;

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {bigint}
 */
function wholeOf(value, what) {
  if (typeof value === "bigint") return value;

  if ((typeof value === "number" && Number.isSafeInteger(value)) || (typeof value === "string" && /^\s*\d+\s*$/.test(value))) {
    return BigInt(/** @type {number | string} */ (value));
  }

  throw new TypeError(`${what} is a whole number`);
}

/**
 * @param {{ amountLux: bigint | number | string, to: string, minGasLimit?: bigint | number, extraData?: Uint8Array | ArrayLike<number> }} deposit
 * @returns {Uint8Array}
 */
export function encodeDepositArgs({ amountLux, extraData = new Uint8Array(0), minGasLimit = DEPOSIT_MIN_GAS_LIMIT, to }) {
  const amount = wholeOf(amountLux, "The amount");
  const gas = wholeOf(minGasLimit, "The minimum gas limit");
  const address = typeof to === "string" ? to.trim() : "";

  if (amount <= 0n || amount > U64_MAX) {
    throw new RangeError("The amount is more than 0 and fits in a u64");
  }

  if (gas < 0n || gas > U32_MAX) {
    throw new RangeError("The minimum gas limit fits in a u32");
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new TypeError("The recipient isn't an EVM address");
  }

  const digits = address.slice(2);

  if (digits !== digits.toLowerCase() && digits !== digits.toUpperCase() && formatEvmAddress(address) !== address) {
    throw new TypeError("The recipient's checksum is wrong");
  }

  const extra = Array.from(/** @type {ArrayLike<number>} */ (extraData ?? []));

  if (!extra.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw new TypeError("The extra data is bytes");
  }

  // The extra data first, padded to 8; then the root, which points back at it.
  const root = Math.ceil(extra.length / 8) * 8;
  const out = new Uint8Array(root + DEPOSIT_ROOT);
  const view = new DataView(out.buffer);

  out.set(extra, 0);
  view.setBigUint64(root, amount, true);
  out.set(fromHex(digits), root + 8);
  view.setUint32(root + 28, Number(gas), true);
  view.setInt32(root + 32, -(root + 32), true);
  view.setUint32(root + 36, extra.length, true);

  return out;
}

/**
 * @param {NetworkRef} net
 * @param {{ amountLux: bigint | number | string, to: string, minGasLimit?: bigint | number, extraData?: Uint8Array | ArrayLike<number> }} deposit
 * @returns {{ contractId: string, deposit: bigint, fnArgs: Uint8Array, fnName: string } | null}
 */
export function depositCall(net, deposit) {
  const contracts = duskEvmContracts(net);

  if (!contracts) {
    return null;
  }

  const fnArgs = encodeDepositArgs(deposit);

  // A deposit sends the DUSK it bridges along as the call's deposit.
  return { contractId: contracts.bridge, deposit: BigInt(deposit.amountLux), fnArgs, fnName: BRIDGE_FUNCTIONS.deposit };
}
