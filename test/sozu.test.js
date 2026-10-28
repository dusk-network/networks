import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import vectors from "../fixtures/sozu-vectors.json" with { type: "json" };
import {
  HUB_NAME_ARGS,
  SOZU_FN,
  SOZU_GAS,
  decodeContractId,
  decodeSwitch,
  decodeU64,
  duskPerStDusk,
  encodeU64,
  feePercent,
  leastSozuStake,
  parseFeeRate,
  parsePool,
  readLux,
  readSozuStatus,
  sozuCall,
  sozuFee,
  sozuStake,
  sozuUnstakeAllowed,
  stDuskFor,
} from "../src/sozu.js";

/** @param {string} hex */
const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

/** @param {Uint8Array} b */
const hex = (b) => Buffer.from(b).toString("hex");

describe("the Sozu test vectors both wallets run", () => {
  /** @param {string} name */
  const pool = (name) => parsePool(vectors.pools[/** @type {keyof typeof vectors.pools} */ (name)]);
  /** @param {string | null} name */
  const deposit = (name) =>
    name
      ? parseFeeRate(bytes(vectors.fees[/** @type {keyof typeof vectors.fees} */ (name)].deposit))
      : null;

  it("ships the vectors byte for byte as the wallets have them", () => {
    const digest = createHash("sha256")
      .update(readFileSync(new URL("../fixtures/sozu-vectors.json", import.meta.url)))
      .digest("hex");

    assert.equal(digest, "1095a80ec8e65de79015e2e4094aa9fb60e28d1075a4c6072c651769d79d872c");
  });

  it("reads each fee rate from the substrate's bytes, and as a percentage", () => {
    for (const rate of vectors.feeRates) {
      const parsed = parseFeeRate(bytes(rate.bytes));

      assert.deepEqual(parsed, {
        denominator: BigInt(rate.denominator),
        numerator: BigInt(rate.numerator),
      });
      assert.equal(feePercent(parsed, "en"), rate.percent);
    }
  });

  it("values a stDUSK at each pool's rate, and nothing without one", () => {
    for (const value of vectors.duskPerStDusk) {
      assert.equal(duskPerStDusk(pool(value.pool)), value.lux === null ? null : BigInt(value.lux));
    }
  });

  for (const stake of vectors.stakes) {
    it(`takes ${stake.amount} lux on the ${stake.pool} pool at ${stake.fees}: fee ${stake.fee}, ${stake.stDusk} stDUSK, ok ${stake.ok}`, () => {
      assert.deepEqual(sozuStake(BigInt(stake.amount), pool(stake.pool), deposit(stake.fees)), {
        fee: BigInt(stake.fee),
        ok: stake.ok,
        stDusk: BigInt(stake.stDusk),
        worth: BigInt(stake.worth),
      });
    });
  }

  for (const minimum of vectors.minimums) {
    it(`gives the least stake on the ${minimum.pool} pool at ${minimum.fees}: ${minimum.least}`, () => {
      const least = leastSozuStake(pool(minimum.pool), deposit(minimum.fees));

      assert.equal(least, minimum.least === null ? null : BigInt(minimum.least));

      if (least !== null) {
        assert.equal(sozuStake(least, pool(minimum.pool), deposit(minimum.fees)).ok, true);
        assert.equal(sozuStake(least - 1n, pool(minimum.pool), deposit(minimum.fees)).ok, false);
      }
    });
  }

  for (const unstake of vectors.unstakes) {
    it(`lets an unstake of ${unstake.amount} with ${unstake.balance} at Sozu go ahead: ${unstake.ok}`, () => {
      assert.equal(sozuUnstakeAllowed(BigInt(unstake.amount), BigInt(unstake.balance)), unstake.ok);
    });
  }
});

describe("Sozu's least stake at fees near 100%", () => {
  const testnet = parsePool(vectors.pools["testnet-2026-10-26"]);
  const U64_MAX = 2n ** 64n - 1n;

  it("has none when no stake can go ahead: a fee over 100%, or a least past any u64", () => {
    assert.equal(leastSozuStake(testnet, { denominator: 2n, numerator: 3n }), null);
    assert.equal(
      leastSozuStake({ stake: U64_MAX, supply: 1n }, { denominator: U64_MAX, numerator: 1n }),
      null
    );
  });

  it("works it out at once: a fee a hair under 100% takes no time", () => {
    const started = performance.now();

    assert.equal(
      leastSozuStake(testnet, { denominator: 10_000_000n, numerator: 9_999_999n }),
      40_000_000n
    );
    assert.ok(performance.now() - started < 50);
  });

  it("gives what counting up gives, for small pools and fees", () => {
    const misses = [];
    let cases = 0;

    for (let stake = 1n; stake <= 40n; stake += 3n) {
      for (let supply = 1n; supply <= 40n; supply += 7n) {
        for (let d = 1n; d <= 12n; d++) {
          for (let n = 0n; n < d; n++) {
            const rate = { denominator: d, numerator: n };
            const least = (stake + supply - 1n) / supply;
            let amount = least;

            while (amount - sozuFee(amount, rate) < least) amount += 1n;

            cases += 1;

            if (leastSozuStake({ stake, supply }, rate) !== amount) {
              misses.push(`${stake}/${supply} at ${n}/${d}`);
            }
          }
        }
      }
    }

    assert.deepEqual(misses, []);
    assert.equal(cases, 14 * 6 * 78);
  });
});

describe("Sozu's amounts", () => {
  it("encodes an amount as a little-endian u64", () => {
    assert.deepEqual(Array.from(encodeU64(1_000_000_000_000n)), [0, 16, 165, 212, 232, 0, 0, 0]);
    assert.throws(() => encodeU64(-1n), RangeError);
    assert.throws(() => encodeU64(2n ** 64n), RangeError);
  });

  it("reads the pool's rate, and mints 1:1 while the pool is empty", () => {
    const pool = parsePool({ denominator: "2647997731233173", numerator: "8142876697294578" });

    assert.deepEqual(pool, { stake: 8_142_876_697_294_578n, supply: 2_647_997_731_233_173n });
    assert.equal(stDuskFor(100_000_000_000n, pool), 32_519_192_291n);
    assert.equal(stDuskFor(1n, parsePool({})), 1n);
    assert.equal(stDuskFor(1n, null), null);
    assert.equal(readLux("-5"), 0n);
    assert.equal(readLux("nope"), 0n);
  });

  it("builds a pool call: a stake sends its amount along, an unstake nothing", () => {
    const pool = "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";

    assert.deepEqual(sozuCall(`0x${pool.toUpperCase()}`, SOZU_FN.STAKE, 1_000_000_000_000n), {
      contractId: pool,
      deposit: 1_000_000_000_000n,
      fnArgs: Uint8Array.of(0, 16, 165, 212, 232, 0, 0, 0),
      fnName: "sozu_stake",
    });
    assert.equal(sozuCall(pool, SOZU_FN.UNSTAKE, 5n).deposit, 0n);
    assert.throws(() => sozuCall("nope", SOZU_FN.STAKE, 5n), TypeError);
    assert.throws(() => sozuCall(pool, /** @type {any} */ ("balance_of"), 5n), TypeError);
    assert.throws(() => sozuCall(pool, SOZU_FN.STAKE, 0n), RangeError);
  });

  it("gives a stake 5M gas, warned under 2.5M, and an unstake 10M, warned under 4M", () => {
    assert.deepEqual(SOZU_GAS, {
      sozu_stake: { limit: 5_000_000n, minimum: 2_500_000n },
      sozu_unstake: { limit: 10_000_000n, minimum: 4_000_000n },
    });
  });
});

describe("Sozu's replies", () => {
  it("reads the hub's Option<ContractId>: a tag, then 32 bytes", () => {
    assert.equal(decodeContractId(Uint8Array.of(1, ...Array(32).fill(0xab))), "ab".repeat(32));
    assert.equal(decodeContractId(new Uint8Array(33)), null);
    assert.throws(() => decodeContractId(Uint8Array.of(2, ...Array(32).fill(0))), RangeError);
    assert.throws(() => decodeContractId(new Uint8Array(32)), RangeError);
  });

  it("reads an amount as 8 bytes, little-endian", () => {
    assert.equal(decodeU64(Uint8Array.of(42, 0, 0, 0, 0, 0, 0, 0)), 42n);
    assert.throws(() => decodeU64(new Uint8Array(4)), RangeError);
  });

  it("reads a switch only from exactly one byte, 0 or 1", () => {
    assert.equal(decodeSwitch(Uint8Array.of(0)), false);
    assert.equal(decodeSwitch(Uint8Array.of(1)), true);
    for (const bad of [Uint8Array.of(2), new Uint8Array(0), Uint8Array.of(0, 0)]) {
      assert.throws(() => decodeSwitch(bad), RangeError);
    }
  });

  it("asks the hub with each name as an rkyv 0.7 string", () => {
    // Inline up to 7 bytes, the length last; longer, the bytes padded to 4,
    // then the length and the offset back to them.
    /** @param {string} name */
    const rkyvString = (name) => {
      const text = new TextEncoder().encode(name);

      if (text.length <= 7) {
        const out = new Uint8Array(8);

        out.set(text);
        out[7] = text.length;
        return hex(out);
      }

      const padded = Math.ceil(text.length / 4) * 4;
      const out = new Uint8Array(padded + 8);
      const view = new DataView(out.buffer);

      out.set(text);
      view.setUint32(padded, text.length, true);
      view.setInt32(padded + 4, -padded, true);
      return hex(out);
    };

    for (const [name, args] of Object.entries(HUB_NAME_ARGS)) {
      assert.equal(args, rkyvString(name), name);
    }
    // As Sozu's hub data driver encodes "pool".
    assert.deepEqual(Array.from(bytes(HUB_NAME_ARGS.pool)), [112, 111, 111, 108, 0, 0, 0, 4]);
  });
});

describe("reading what an account has with Sozu", () => {
  const HUB = "bae85f8c24730a5a19fbe3d3bd58248ac8c302b62fe414a8c640d8c0ed286b9e";
  const POOL = "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";
  const STDUSK = "fdbf49102e76cf58224003451c6cb9e3403c54ff1d9042f8bc46ec25c6a4337c";
  const SUBSTRATE = "0077ecbf88aa20d6d0a6afa20bd26300a2b562fdbac368bf1e3c1325e8555941";
  const OTHER_POOL = "ef".repeat(32);
  const ACCOUNT = Uint8Array.of(9, 9, 9);
  const contracts = { hub: HUB, pool: POOL, stDusk: STDUSK, substrate: SUBSTRATE };
  /** @param {bigint} n */
  const u64 = (n) => encodeU64(n);
  /** @param {bigint} a @param {bigint} b */
  const ratio = (a, b) => Uint8Array.of(...u64(a), ...u64(b));
  /** @param {string | null} id */
  const named = (id) => (id ? Uint8Array.of(1, ...bytes(id)) : new Uint8Array(33));

  /**
   * A chain the reads go to: the hub names `names`, each pool answers its
   * figures, and `fail` makes a read fail.
   *
   * @param {{ names?: Record<string, string | null>, fail?: (id: string, fn: string, args: string) => boolean, maintenance?: Uint8Array }} [chain]
   */
  function chainOf({ names = {}, fail = () => false, maintenance = Uint8Array.of(0) } = {}) {
    /** @type {string[]} */
    const calls = [];
    const hubNames = { pool: POOL, "staked-dusk": STDUSK, substrate: SUBSTRATE, ...names };
    /** @type {import("../src/sozu.js").SozuRead} */
    const read = (id, fn, args) => {
      calls.push(`${id.slice(0, 4)} ${fn} ${hex(args)}`);

      if (fail(id, fn, hex(args))) return Promise.reject(new Error(`${fn} failed`));

      if (id === HUB && fn === "contract") {
        const name = Object.entries(HUB_NAME_ARGS).find(([, a]) => a === hex(args))?.[0] ?? "";

        return Promise.resolve(named(/** @type {any} */ (hubNames)[name] ?? null));
      }

      if (fn === "exchange_rate") return Promise.resolve(id === POOL ? ratio(300n, 100n) : ratio(500n, 100n));
      if (fn === "balance_of") return Promise.resolve(u64(id === STDUSK ? 7n : id === POOL ? 21n : 35n));
      if (fn === "stake_fee_rate") return Promise.resolve(hex(args) === "00" ? ratio(1n, 400n) : ratio(15n, 100n));
      if (fn === "is_feature_enabled") return Promise.resolve(hex(args) === "00" ? maintenance : Uint8Array.of(0));

      return Promise.reject(new Error(`no ${fn}`));
    };

    return { calls, read };
  }

  it("starts every read at once, the hub's names first, and gives the figures", async () => {
    const { calls, read } = chainOf();
    const pending = readSozuStatus({ account: ACCOUNT, contracts, named: new Map(), read });

    // All ten reads before anything was awaited: one query for a batcher.
    assert.equal(calls.length, 10);
    assert.deepEqual(calls.slice(0, 3), [
      `bae8 contract ${HUB_NAME_ARGS.pool}`,
      `bae8 contract ${HUB_NAME_ARGS["staked-dusk"]}`,
      `bae8 contract ${HUB_NAME_ARGS.substrate}`,
    ]);

    const status = await pending;

    assert.equal(calls.length, 10);
    assert.deepEqual(status, {
      contracts: { hub: HUB, pool: POOL, stDusk: STDUSK, substrate: SUBSTRATE },
      error: "",
      fees: {
        deposit: { denominator: 400n, numerator: 1n },
        reward: { denominator: 100n, numerator: 15n },
      },
      flags: { maintenance: false, synchronization: false },
      pool: { stake: 300n, supply: 100n },
      position: { balance: 21n, stDusk: 7n },
      source: "hub",
    });
  });

  it("reads again from another pool the hub names, and from it next time", async () => {
    const memory = new Map();
    const first = chainOf({ names: { pool: OTHER_POOL } });
    const status = await readSozuStatus({ account: ACCOUNT, contracts, named: memory, read: first.read });

    assert.equal(status.contracts.pool, OTHER_POOL);
    assert.deepEqual(status.pool, { stake: 500n, supply: 100n });
    assert.equal(status.position?.balance, 35n);
    assert.equal(first.calls.length, 17);

    const next = chainOf({ names: { pool: OTHER_POOL } });
    const again = await readSozuStatus({ account: ACCOUNT, contracts, named: memory, read: next.read });

    assert.equal(again.contracts.pool, OTHER_POOL);
    assert.equal(next.calls.length, 10);
  });

  it("keeps the contract the hub named last when it names none, or can't answer", async () => {
    const memory = new Map();

    await readSozuStatus({ contracts, named: memory, read: chainOf({ names: { pool: OTHER_POOL } }).read });

    const failing = await readSozuStatus({
      contracts,
      named: memory,
      read: chainOf({ fail: (id, fn) => id === HUB && fn === "contract" }).read,
    });

    assert.equal(failing.contracts.pool, OTHER_POOL);
    assert.equal(failing.source, "hub");
    assert.equal(failing.error, "contract failed");

    const none = await readSozuStatus({ contracts, named: memory, read: chainOf({ names: { pool: null } }).read });

    assert.equal(none.contracts.pool, OTHER_POOL);
    assert.equal(none.source, "fallback");
  });

  it("says a figure couldn't be read, and keeps the others", async () => {
    const status = await readSozuStatus({
      account: ACCOUNT,
      contracts,
      named: new Map(),
      read: chainOf({ fail: (_id, fn, args) => fn === "stake_fee_rate" && args === "01" }).read,
    });

    assert.equal(status.fees, null);
    assert.equal(status.error, "stake_fee_rate failed");
    assert.deepEqual(status.pool, { stake: 300n, supply: 100n });
    assert.deepEqual(status.position, { balance: 21n, stDusk: 7n });
  });

  it("reads a stDUSK balance it has no token for as unknown, not as none", async () => {
    const status = await readSozuStatus({
      account: ACCOUNT,
      contracts: { hub: HUB, pool: POOL, substrate: SUBSTRATE },
      named: new Map(),
      read: chainOf({ names: { "staked-dusk": null } }).read,
    });

    assert.deepEqual(status.position, { balance: 21n, stDusk: null });
    assert.equal(status.contracts.stDusk, null);
    assert.match(status.error, /aren't known/);
  });

  it("reads a switch it can't make sense of as unknown, not off", async () => {
    const status = await readSozuStatus({
      contracts,
      named: new Map(),
      read: chainOf({ maintenance: Uint8Array.of(2) }).read,
    });

    assert.deepEqual(status.flags, { maintenance: null, synchronization: false });
  });

  it("reads no balances without an account, and the hub's names alone at first", async () => {
    const { calls, read } = chainOf();
    const status = await readSozuStatus({ contracts: { hub: HUB }, named: new Map(), read });

    assert.equal(status.position, null);
    assert.equal(status.source, "hub");
    assert.ok(!calls.some((call) => call.includes("balance_of")));
    assert.deepEqual(status.pool, { stake: 300n, supply: 100n });
  });

  it("takes a read that throws as one that failed", async () => {
    const status = await readSozuStatus({
      contracts,
      named: new Map(),
      read: () => {
        throw new Error("offline");
      },
    });

    assert.equal(status.pool, null);
    assert.equal(status.fees, null);
    assert.equal(status.error, "offline");
    assert.equal(status.source, "fallback");
  });

  it("starts from a network's Sozu entry as it is", async () => {
    const { calls, read } = chainOf({ names: { pool: null, "staked-dusk": null, substrate: null } });
    const status = await readSozuStatus({
      contracts: { fallbacks: { pool: POOL, relayer: "", stDusk: STDUSK, substrate: SUBSTRATE, vault: "" }, hub: HUB },
      named: new Map(),
      read,
    });

    assert.deepEqual(status.contracts, { hub: HUB, pool: POOL, stDusk: STDUSK, substrate: SUBSTRATE });
    assert.equal(status.source, "fallback");
    assert.equal(calls.length, 8);
  });

  it("refuses a hub that isn't a contract ID", async () => {
    await assert.rejects(
      readSozuStatus({ contracts: { hub: "nope" }, read: () => new Uint8Array(0) }),
      TypeError
    );
  });
});
