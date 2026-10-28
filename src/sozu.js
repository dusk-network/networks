/**
 * Sozu: liquid staking on Dusk, run by a third party. Its rules as its
 * contracts (v1.0.0) apply them, and the reads that give an account's
 * figures. Amounts are lux, as bigints.
 *
 * The reads go through a `read(contractId, fnName, argBytes)` the app
 * gives, so each app keeps its own Multicall batcher. Every argument but the
 * account is fixed bytes here and every reply is plain rkyv, so no read
 * needs a data driver; the app encodes the account, as the pool's data
 * driver does.
 *
 * @module
 */

/** Lux in one DUSK, and in one stDUSK. */
const ONE = 1_000_000_000n;

const U64_MAX = 0xffff_ffff_ffff_ffffn;

/** The pool's functions a wallet calls. */
export const SOZU_FN = Object.freeze({
  STAKE: "sozu_stake",
  UNSTAKE: "sozu_unstake",
});

/**
 * Gas for a wallet's own calls of the pool, at the node's price. Under Rusk
 * 1.7.1 a stake spends about 2.2M and an unstake 2.8M to 3.7M, about 6.3M
 * for one that reaches every provisioner of the mainnet pool. A failed call
 * is charged its whole limit, so the limits stay close; warn while typing
 * under `minimum`.
 */
export const SOZU_GAS = Object.freeze({
  [SOZU_FN.STAKE]: Object.freeze({ limit: 5_000_000n, minimum: 2_500_000n }),
  [SOZU_FN.UNSTAKE]: Object.freeze({
    limit: 10_000_000n,
    minimum: 4_000_000n,
  }),
});

/**
 * An amount as Sozu's pool takes it: a u64, in 8 bytes, little-endian.
 *
 * @param {bigint} value
 * @returns {Uint8Array}
 */
export function encodeU64(value) {
  if (value < 0n || value > U64_MAX) {
    throw new RangeError("The amount doesn't fit in a u64");
  }

  const bytes = new Uint8Array(8);

  new DataView(bytes.buffer).setBigUint64(0, value, true);

  return bytes;
}

/**
 * @param {unknown} value
 * @returns {bigint}
 */
const toLux = (value) => {
  try {
    const lux = BigInt(/** @type {string | number | bigint} */ (value ?? 0));

    return lux > 0n ? lux : 0n;
  } catch {
    return 0n;
  }
};

/**
 * The pool's rate as its `exchange_rate` gives it: the DUSK staked through
 * the pool over the stDUSK there is.
 *
 * @param {unknown} rate `{ numerator, denominator }`, as numbers, strings or bigints
 * @returns {{ stake: bigint, supply: bigint }}
 */
export function parsePool(rate) {
  const { denominator, numerator } = /** @type {Record<string, unknown>} */ (
    rate ?? {}
  );

  return { stake: toLux(numerator), supply: toLux(denominator) };
}

/**
 * A ratio as Sozu's contracts give it: two little-endian u64s, the
 * numerator, then the denominator. The pool's `exchange_rate` (a `Rate`)
 * and the substrate's `stake_fee_rate` (a `FeeRate`) both answer so.
 *
 * @param {Uint8Array} bytes
 * @returns {{ numerator: bigint, denominator: bigint }}
 */
export function parseFeeRate(bytes) {
  if (bytes?.length !== 16) {
    throw new RangeError("A fee rate is 16 bytes");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, 16);

  return {
    denominator: view.getBigUint64(8, true),
    numerator: view.getBigUint64(0, true),
  };
}

/**
 * The fee Sozu takes from `amount` at `rate`, in lux, rounded up as its pool
 * rounds it.
 *
 * @param {bigint} amount
 * @param {{ numerator: bigint, denominator: bigint }} rate
 */
export const sozuFee = (amount, { denominator, numerator }) =>
  denominator > 0n && amount > 0n
    ? (amount * numerator + denominator - 1n) / denominator
    : 0n;

/**
 * A fee rate as a percentage: "0.25%", "15%".
 *
 * @param {{ numerator: bigint, denominator: bigint }} rate
 * @param {string} [locale]
 */
export const feePercent = ({ denominator, numerator }, locale) =>
  new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    style: "percent",
  }).format(denominator > 0n ? Number(numerator) / Number(denominator) : 0);

/**
 * About how much stDUSK a stake of `amount` gets now, before any fee Sozu
 * takes, rounded down as its pool rounds it: 1:1 while the pool has no stake
 * or no stDUSK, as its contract mints then; null without the pool's rate.
 *
 * @param {bigint} amount
 * @param {{ stake: bigint, supply: bigint } | null} pool
 * @returns {bigint | null}
 */
export function stDuskFor(amount, pool) {
  if (!pool) {
    return null;
  }

  return pool.stake > 0n && pool.supply > 0n
    ? (amount * pool.supply) / pool.stake
    : amount;
}

/**
 * A stake of `amount` with Sozu, as its pool takes it: the deposit fee,
 * rounded up; what's left, which the stDUSK is worth now; and the stDUSK,
 * rounded down. It goes ahead only when the fee leaves something and that
 * gets at least 1 lux of stDUSK. Anything less, the pool refuses, and the
 * call is charged its whole gas limit.
 *
 * @param {bigint} amount
 * @param {{ stake: bigint, supply: bigint } | null} pool
 * @param {{ numerator: bigint, denominator: bigint } | null} [depositFee]
 * @returns {{ fee: bigint, ok: boolean, stDusk: bigint | null, worth: bigint }}
 */
export function sozuStake(amount, pool, depositFee = null) {
  const fee = depositFee ? sozuFee(amount, depositFee) : 0n;
  const worth = amount > fee ? amount - fee : 0n;
  const stDusk = worth > 0n ? stDuskFor(worth, pool) : 0n;

  return {
    fee,
    ok: amount > fee && stDusk !== null && stDusk >= 1n,
    stDusk,
    worth,
  };
}

/**
 * Whether an unstake of `amount` goes ahead: more than nothing, and no more
 * than what the account has with Sozu (`pool.balance_of`), which is the
 * Max. It pays out in the same transaction, with no fee.
 *
 * @param {bigint} amount
 * @param {bigint} balance
 */
export const sozuUnstakeAllowed = (amount, balance) =>
  amount > 0n && amount <= balance;

/**
 * The least a stake gets any stDUSK for at the rate now, in lux, after the
 * deposit fee where it's known: 1 without a rate. Null when no stake can: a
 * fee of 100% or more, or a least past the largest amount there is (a u64).
 *
 * @param {{ stake: bigint, supply: bigint } | null} pool
 * @param {{ numerator: bigint, denominator: bigint } | null} [depositFee]
 * @returns {bigint | null}
 */
export function leastSozuStake(pool, depositFee = null) {
  const least =
    pool && pool.stake > 0n && pool.supply > 0n
      ? (pool.stake + pool.supply - 1n) / pool.supply
      : 1n;

  if (
    !depositFee ||
    depositFee.denominator <= 0n ||
    depositFee.numerator <= 0n
  ) {
    return least;
  }

  const { denominator: d, numerator: n } = depositFee;

  if (n >= d) {
    return null;
  }

  // What's left after the fee, amount − ⌈amount·n/d⌉, is ⌊amount·(d − n)/d⌋:
  // it reaches `least` from ⌈least·d/(d − n)⌉ on, worked out at once.
  const amount = (least * d + (d - n) - 1n) / (d - n);

  return amount <= U64_MAX ? amount : null;
}

/**
 * What one stDUSK is worth now, in lux; null without a rate.
 *
 * @param {{ stake: bigint, supply: bigint } | null} pool
 * @returns {bigint | null}
 */
export const duskPerStDusk = (pool) =>
  pool && pool.stake > 0n && pool.supply > 0n
    ? (ONE * pool.stake) / pool.supply
    : null;

/**
 * An amount the pool's reads give, as lux: 0 for anything that isn't one.
 *
 * @param {unknown} value
 */
export const readLux = toLux;

/** @param {Uint8Array} bytes */
const toHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** @param {string} hex */
const fromHex = (hex) =>
  Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

/**
 * `hub.contract(name)`'s argument for each name the hub keeps: the name as
 * an rkyv 0.7 `String`, as Sozu's hub data driver encodes it. A name of up
 * to 7 bytes sits inline, with its length in the last byte; a longer one
 * comes first, then its length and its offset.
 */
export const HUB_NAME_ARGS = Object.freeze({
  pool: "706f6f6c00000004",
  relayer: "72656c6179657207",
  "staked-dusk": "7374616b65642d6475736b000b000000f4ffffff",
  substrate: "73756273747261746500000009000000f4ffffff",
  vault: "7661756c74000005",
});

/** The substrate's enums, one byte each: `StakeFeeKind` and `FeatureKind`. */
export const SUBSTRATE_KINDS = Object.freeze({
  deposit: 0,
  maintenance: 0,
  reward: 1,
  synchronization: 1,
});

/**
 * `hub.contract`'s reply, an `Option<ContractId>`: a tag, 0 for none or 1,
 * then the 32 bytes of the ID.
 *
 * @param {Uint8Array} bytes
 * @returns {string | null} The ID in lower-case hex, or null when the hub names none
 */
export function decodeContractId(bytes) {
  if (bytes?.length !== 33 || bytes[0] > 1) {
    throw new RangeError("A contract ID reply is a tag and 32 bytes");
  }

  return bytes[0] === 1 ? toHex(bytes.subarray(1)) : null;
}

/**
 * A u64 reply, little-endian: a balance.
 *
 * @param {Uint8Array} bytes
 * @returns {bigint}
 */
export function decodeU64(bytes) {
  if (bytes?.length !== 8) {
    throw new RangeError("An amount is 8 bytes");
  }

  return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
}

/**
 * Whether a switch is on, as `is_feature_enabled` gives it: a bool, one
 * byte, 0 or 1. Anything else is a switch that couldn't be read, not one
 * that is off.
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function decodeSwitch(bytes) {
  if (bytes?.length !== 1 || bytes[0] > 1) {
    throw new RangeError("A switch is one byte, 0 or 1");
  }

  return bytes[0] === 1;
}

/**
 * A stake or an unstake as a transaction carries it: the pool, the function
 * and the amount in DUSK's lux, as a u64. A stake sends the amount along as
 * its deposit; an unstake sends nothing. Both go from a public account.
 *
 * @param {string} poolId The pool's contract ID, in hex
 * @param {"sozu_stake" | "sozu_unstake"} fnName
 * @param {bigint} amount
 * @returns {{ contractId: string, deposit: bigint, fnArgs: Uint8Array, fnName: string }}
 */
export function sozuCall(poolId, fnName, amount) {
  const contractId = String(poolId).toLowerCase().replace(/^0x/, "");

  if (!/^[0-9a-f]{64}$/.test(contractId)) {
    throw new TypeError("Not a contract ID");
  }

  if (fnName !== SOZU_FN.STAKE && fnName !== SOZU_FN.UNSTAKE) {
    throw new TypeError("Not one of Sozu's pool functions");
  }

  if (amount <= 0n) {
    throw new RangeError("The amount must be more than 0");
  }

  return {
    contractId,
    deposit: fnName === SOZU_FN.STAKE ? amount : 0n,
    fnArgs: encodeU64(amount),
    fnName,
  };
}

/** The names a status read asks the hub, and the key each is kept under. */
const NAMES = Object.freeze(
  /** @type {const} */ ([
    ["pool", "pool"],
    ["stDusk", "staked-dusk"],
    ["substrate", "substrate"],
  ])
);

/**
 * What each hub named last, and whether the hub named it: where the next
 * read takes the figures from.
 *
 * @type {Map<string, import("./sozu.js").SozuNamed>}
 */
const namedLast = new Map();

/**
 * @param {unknown} error
 * @returns {string}
 */
const messageOf = (error) =>
  error instanceof Error ? error.message : String(error);

/**
 * @param {unknown} id
 * @returns {string | null}
 */
const contractIdOf = (id) => {
  const hex = typeof id === "string" ? id.toLowerCase().replace(/^0x/, "") : "";

  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
};

/**
 * A read through the app's `read`, started now: one that throws at once is
 * a read that failed.
 *
 * @param {import("./sozu.js").SozuRead} read
 * @param {string} id
 * @param {string} fnName
 * @param {Uint8Array} args
 * @returns {Promise<Uint8Array>}
 */
function start(read, id, fnName, args) {
  try {
    return Promise.resolve(read(id, fnName, args));
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * The figures, from the contracts `ids` names, all started at once so they
 * go in the query of the moment. Each is null when it couldn't be read, as
 * one from a contract that isn't known is.
 *
 * @param {import("./sozu.js").SozuRead} read
 * @param {import("./sozu.js").SozuContractIds} ids
 * @param {Uint8Array | null} account
 */
function readFigures(read, ids, account) {
  /**
   * @template T
   * @param {string | null} id
   * @param {string} fnName
   * @param {Uint8Array} args
   * @param {(bytes: Uint8Array) => T} decode
   * @returns {Promise<T>}
   */
  const at = (id, fnName, args, decode) =>
    id
      ? start(read, id, fnName, args).then(decode)
      : Promise.reject(new Error("Sozu's contracts aren't known"));
  /** @param {keyof typeof SUBSTRATE_KINDS} name */
  const kind = (name) => Uint8Array.of(SUBSTRATE_KINDS[name]);
  const { pool, stDusk, substrate } = ids;
  const reads = [
    at(pool, "exchange_rate", new Uint8Array(0), parseFeeRate),
    account ? at(pool, "balance_of", account, decodeU64) : null,
    account ? at(stDusk, "balance_of", account, decodeU64) : null,
    at(substrate, "stake_fee_rate", kind("deposit"), parseFeeRate),
    at(substrate, "stake_fee_rate", kind("reward"), parseFeeRate),
    at(substrate, "is_feature_enabled", kind("maintenance"), decodeSwitch),
    at(substrate, "is_feature_enabled", kind("synchronization"), decodeSwitch),
  ];

  return Promise.allSettled(reads).then((settled) => {
    const [rate, balance, staked, deposit, reward, maintenance, sync] =
      settled.map((r) => (r.status === "fulfilled" ? r.value : null));
    const failed = settled.find((r) => r.status === "rejected");

    return {
      error: failed?.status === "rejected" ? messageOf(failed.reason) : "",
      fees:
        deposit && reward
          ? {
              deposit: /** @type {import("./sozu.js").SozuFeeRate} */ (deposit),
              reward: /** @type {import("./sozu.js").SozuFeeRate} */ (reward),
            }
          : null,
      flags: {
        maintenance: /** @type {boolean | null} */ (maintenance),
        synchronization: /** @type {boolean | null} */ (sync),
      },
      pool: rate ? parsePool(rate) : null,
      // No balances without an account; with one, each is null when it
      // couldn't be read, the stDUSK token's too while no one names it.
      position: account
        ? {
            balance: typeof balance === "bigint" ? balance : null,
            stDusk: typeof staked === "bigint" ? staked : null,
          }
        : null,
    };
  });
}

/**
 * Reads what an account has with Sozu, in one query a refresh: the
 * contracts the hub names, the pool's rate, the account's balances there,
 * Sozu's fees and its two switches. Every read starts before this returns
 * to the caller's task, the hub's three names first, so a batcher sends
 * them as one query.
 *
 * The hub's guardian can name other contracts at any time, so each read
 * asks it again, in the same query as the figures. Those are read from the
 * contracts it named last (at first, the fallbacks), and read again from
 * the new ones only when it names others. A name it has no contract for,
 * or can't answer now, keeps the one it named last.
 *
 * @param {{
 *   read: import("./sozu.js").SozuRead,
 *   contracts: import("./sozu.js").SozuStart,
 *   account?: Uint8Array | null,
 *   named?: Map<string, import("./sozu.js").SozuNamed>,
 * }} options `contracts` are the hub and the fallbacks: a network's `sozu`
 *   as it is, or `{ hub, pool, stDusk, substrate }`; `account` is
 *   `balance_of`'s argument, as the pool's data driver encodes the account,
 *   or null to read no balances; `named` keeps what each hub named last
 *   (one map for the app, by default).
 * @returns {Promise<import("./sozu.js").SozuStatus>}
 */
export async function readSozuStatus({
  read,
  contracts,
  account = null,
  named = namedLast,
}) {
  const hub = contractIdOf(contracts?.hub);

  if (!hub) {
    throw new TypeError("Sozu's hub isn't a contract ID");
  }

  /** @type {Record<string, unknown>} */
  const known =
    "fallbacks" in contracts && contracts.fallbacks
      ? contracts.fallbacks
      : /** @type {Record<string, unknown>} */ (contracts);
  const fallback = /** @type {import("./sozu.js").SozuContractIds} */ (
    Object.fromEntries(NAMES.map(([key]) => [key, contractIdOf(known[key])]))
  );
  const held = named.get(hub);
  let ids = held?.ids ?? fallback;
  // One task: the hub's names, then the figures from what it named last.
  const asked = Promise.allSettled(
    NAMES.map(([, name]) =>
      start(read, hub, "contract", fromHex(HUB_NAME_ARGS[name])).then(
        decodeContractId
      )
    )
  );
  let figures = readFigures(read, ids, account);
  const answers = await asked;
  const now = { ...ids };
  const fromHub = {
    ...(held?.fromHub ?? { pool: false, stDusk: false, substrate: false }),
  };

  NAMES.forEach(([key], i) => {
    const answer = answers[i];

    if (answer.status !== "fulfilled") {
      return;
    }

    if (answer.value) {
      now[key] = answer.value;
    }

    fromHub[key] = Boolean(answer.value);
  });
  named.set(hub, { fromHub, ids: now });

  // Read again only from others the hub names now.
  if (NAMES.some(([key]) => now[key] !== ids[key])) {
    ids = now;
    figures = readFigures(read, ids, account);
  }

  const result = await figures;
  const hubFailed = answers.find((a) => a.status === "rejected");

  return {
    contracts: { hub, ...ids },
    error:
      result.error ||
      (hubFailed?.status === "rejected" ? messageOf(hubFailed.reason) : ""),
    fees: result.fees,
    flags: result.flags,
    pool: result.pool,
    position: result.position,
    source: NAMES.every(([key]) => fromHub[key]) ? "hub" : "fallback",
  };
}
