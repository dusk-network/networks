import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { networks } from "../src/index.js";
import { checkNetwork } from "../scripts/lib/check.mjs";
import { decodeAggregate, encodeAggregate, fromHex, toHex } from "../scripts/lib/multicall.mjs";
import { validate } from "../scripts/lib/schema.mjs";
import { generate, labelOf, main, merge } from "../scripts/gen-duskevm.mjs";

/**
 * An `aggregate` reply as rkyv 0.7 lays it out: the bytes results point
 * to, then a 16-byte slot per result, then the root.
 *
 * @param {bigint} height
 * @param {({ ok: Uint8Array } | { error: string })[]} results
 */
function reply(height, results) {
  const align = (/** @type {number} */ n, /** @type {number} */ to) => Math.ceil(n / to) * to;
  const text = new TextEncoder();
  const outside = results.map((r) =>
    "ok" in r ? r.ok : r.error.startsWith("Panic: ") && text.encode(r.error.slice(7)).length > 7 ? text.encode(r.error.slice(7)) : new Uint8Array(0)
  );
  const data = outside.reduce((n, b) => n + b.length, 0);
  const slots = align(data, 4);
  const root = align(slots + 16 * results.length, 8);
  const out = new Uint8Array(root + 16);
  const view = new DataView(out.buffer);
  let at = 0;

  results.forEach((r, i) => {
    const slot = slots + 16 * i;

    out.set(outside[i], at);

    if ("ok" in r) {
      view.setInt32(slot + 4, at - (slot + 4), true);
      view.setUint32(slot + 8, r.ok.length, true);
    } else {
      out[slot] = 1;
      const kinds = { DoesNotExist: 2, OutOfGas: 1, Unknown: 3 };

      if (r.error in kinds) {
        out[slot + 4] = kinds[/** @type {keyof typeof kinds} */ (r.error)];
      } else {
        const message = text.encode(r.error.slice(7));

        if (message.length <= 7) {
          out.set(message, slot + 8);
          out[slot + 15] = message.length;
        } else {
          view.setUint32(slot + 8, message.length, true);
          view.setInt32(slot + 12, at - (slot + 8), true);
        }
      }
    }

    at += outside[i].length;
  });
  view.setBigUint64(root, height, true);
  view.setInt32(root + 8, slots - (root + 8), true);
  view.setUint32(root + 12, results.length, true);

  return out;
}

describe("the Multicall envelope", () => {
  it("is the bytes the Dusk Domains SDK's encoder gives", () => {
    const envelope = encodeAggregate([
      {
        args: fromHex("706f6f6c00000004"),
        contractId: "bae85f8c24730a5a19fbe3d3bd58248ac8c302b62fe414a8c640d8c0ed286b9e",
        fnName: "contract",
      },
      {
        args: fromHex("72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2"),
        contractId: `01${"0".repeat(62)}`,
        fnName: "contract_balance",
        gasLimit: 1_000_000n,
      },
    ]);

    // From @duskdomains/sdk 0.5.4's encodeAggregate for the same calls.
    assert.equal(
      toHex(envelope),
      "636f6e7472616374706f6f6c00000004636f6e74726163745f62616c616e636572883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2bae85f8c24730a5a19fbe3d3bd58248ac8c302b62fe414a8c640d8c0ed286b9e08000000a0ffffffa0ffffff08000000000000000000000001000000000000000000000000000000000000000000000000000000000000001000000078ffffff80ffffff2000000040420f000000000090ffffff02000000"
    );
  });

  it("reads each result back, every kind of error included", () => {
    const results = [
      { ok: Uint8Array.of(1, 2, 3) },
      { error: "OutOfGas" },
      { error: "DoesNotExist" },
      { error: "Unknown" },
      { error: "Panic: short" },
      { error: "Panic: a longer message" },
      { ok: new Uint8Array(0) },
    ];
    const decoded = decodeAggregate(reply(4_708_251n, results), results.length);

    assert.equal(decoded.height, 4_708_251n);
    assert.deepEqual(decoded.results, results);
    assert.throws(() => decodeAggregate(reply(1n, results), 3), /answered 7 calls, not 3/);
  });
});

describe("the schema check", () => {
  it("refuses a keyword it doesn't check, so no rule is skipped", () => {
    for (const [schema, keyword] of [
      [{ type: "string", format: "uri" }, /format/],
      [{ const: 1 }, /const/],
      [{ $ref: "#/$defs/missing" }, /missing/],
    ]) {
      assert.throws(() => validate(schema, "x"), keyword);
    }
  });

  it("compares items and choices whatever order their keys are in", () => {
    const unique = { items: { type: "object" }, type: "array", uniqueItems: true };

    assert.deepEqual(validate(unique, [{ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }]), [
      "$: items repeat",
    ]);
    assert.deepEqual(validate(unique, [{ a: 1, b: 2 }, { a: 2, b: 1 }]), []);
    assert.deepEqual(validate({ enum: [{ a: 1, b: 2 }] }, { b: 2, a: 1 }), []);
    assert.equal(validate({ enum: [{ a: 1, b: 2 }] }, { a: 1, b: 3 }).length, 1);
  });

  it("checks references, options and extra keys", () => {
    const schema = {
      $defs: { id: { pattern: "^[0-9a-f]{4}$", type: "string" } },
      additionalProperties: false,
      properties: { id: { anyOf: [{ type: "null" }, { $ref: "#/$defs/id" }] } },
      required: ["id"],
      type: "object",
    };

    assert.deepEqual(validate(schema, { id: null }), []);
    assert.deepEqual(validate(schema, { id: "beef" }), []);
    assert.equal(validate(schema, { id: "BEEF" }).length, 1);
    assert.deepEqual(validate(schema, { other: 1 }), ["$: missing id", "$.other: not allowed"]);
  });
});

describe("check-chain", () => {
  const MANIFEST = new TextEncoder().encode("a manifest");
  const testnet = {
    ...networks.testnet,
    duskDomains: {
      .../** @type {NonNullable<typeof networks.testnet.duskDomains>} */ (networks.testnet.duskDomains),
      manifest: {
        .../** @type {NonNullable<typeof networks.testnet.duskDomains>} */ (networks.testnet.duskDomains).manifest,
        sha256: createHash("sha256").update(MANIFEST).digest("hex"),
      },
    },
  };
  const fallbacks = /** @type {NonNullable<typeof testnet.sozu>} */ (testnet.sozu).fallbacks;
  const names = [fallbacks.pool, fallbacks.relayer, fallbacks.stDusk, fallbacks.substrate, fallbacks.vault];
  const probes = 2 + 5 + 21;

  /**
   * A node and a manifest host that answer as `answers` says.
   *
   * @param {{ hub?: string[], missing?: number, manifest?: Uint8Array }} [answers]
   */
  function chain({ hub = names, missing = -1, manifest = MANIFEST } = {}) {
    /** @type {string[]} */
    const asked = [];
    /** @type {typeof fetch} */
    const fetch = async (input, init) => {
      const url = String(input);

      asked.push(`${init?.method ?? "GET"} ${url}`);

      if (url.endsWith("/aggregate")) {
        const results = [
          ...hub.map((id) => ({ ok: Uint8Array.of(1, ...fromHex(id)) })),
          ...Array.from({ length: probes }, (_, i) => ({ error: i === missing ? "DoesNotExist" : "Unknown" })),
        ];

        return new Response(reply(4_708_251n, results));
      }

      return new Response(manifest);
    };

    return { asked, fetch };
  }

  it("asks one query of the node, and finds the file right", async () => {
    const { asked, fetch } = chain();
    /** @type {string[]} */
    const lines = [];
    const problems = await checkNetwork(testnet, { fetch, log: (line) => lines.push(line) });

    assert.deepEqual(problems, []);
    assert.deepEqual(asked, [
      "POST https://testnet.nodes.dusk.network/on/contracts:93de287b7d349d678a0038fe7772e8960e1a84a1b5da2d0b1f62f532616ce1d4/aggregate",
      "GET https://testnet.dusk.domains/manifest.json",
    ]);
    assert.ok(lines.includes(`  ${probes} of ${probes} other contracts are on chain`), lines.join("\n"));
  });

  it("says what differs: another contract named, one gone, a changed manifest", async () => {
    const { fetch } = chain({
      hub: [names[0].replace(/^../, "ff"), ...names.slice(1)],
      manifest: new TextEncoder().encode("another manifest"),
      missing: 1,
    });
    const problems = await checkNetwork(testnet, { fetch, log: () => {} });

    assert.equal(problems.length, 3, problems.join("\n"));
    assert.match(problems[0], /names ff.* as "pool"/);
    assert.match(problems[1], /^contracts\.stake 02.* isn't on chain$/);
    assert.match(problems[2], /^Dusk Domains manifest/);
  });
});

describe("gen-duskevm", () => {
  const PORTAL = "0x19e05e040e2b35dd705ef031759c1697727cf6de";
  const SYSTEM_CONFIG = "0x539becbf5d6fff4a991602d8bc8c1820b5981b0d";

  /**
   * A duskevm-genesis checkout with a few contracts, in a folder of its own.
   *
   * @param {{ l1ChainId?: number, deposit?: string, drop?: string[] }} [options]
   *   `drop` leaves out these keys, from the contracts and from rollup.json
   */
  function genesis({ l1ChainId = 2, deposit = PORTAL, drop = [] } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "networks-genesis-"));
    const contract = (id, evm) => ({ contract_id: id.repeat(32), evm_address: evm, wasm: "x.wasm" });
    /** @type {Record<string, unknown>} */
    const contracts = {
      brand_new_contract: contract("cd", "0x00000000000000000000000000000000000000cd"),
      optimism_portal: contract("ab", PORTAL),
      system_config: contract("ef", SYSTEM_CONFIG),
      transparent_proxy: contract("ef", "0xdc05b5507fb495b6729854bdcdffbcae110ef98b"),
    };
    /** @type {Record<string, unknown>} */
    const rollup = {
      deposit_contract_address: deposit,
      l1_chain_id: l1ChainId,
      l1_system_config_address: SYSTEM_CONFIG,
      l2_chain_id: 745,
    };

    for (const key of drop) {
      delete contracts[key];
      delete rollup[key];
    }

    mkdirSync(join(dir, "testnet"));
    writeFileSync(
      join(dir, "testnet", "l1-addresses.json"),
      JSON.stringify({
        contracts,
        metadata: { proxy_forwarded_event_schemas: [{ proxy_contract_id: "ef".repeat(32), proxy_contract_key: "system_config" }] },
      })
    );
    writeFileSync(join(dir, "testnet", "rollup.json"), JSON.stringify(rollup));

    return {
      dir,
      remove: () => {
        for (const file of ["l1-addresses.json", "rollup.json"]) unlinkSync(join(dir, "testnet", file));
        rmdirSync(join(dir, "testnet"));
        rmdirSync(dir);
      },
    };
  }

  it("takes each contract, checksummed, and one label per contract ID", () => {
    const checkout = genesis();

    try {
      const generated = generate(checkout.dir, "testnet", networks.testnet);

      assert.deepEqual(Object.keys(generated.contracts), [
        "brand_new_contract",
        "optimism_portal",
        "system_config",
        "transparent_proxy",
      ]);
      assert.equal(generated.contracts.optimism_portal.evmAddress, "0x19e05E040E2B35dD705EF031759c1697727CF6dE");
      assert.deepEqual(generated.labels, {
        ["ab".repeat(32)]: "DuskEVM bridge portal",
        ["cd".repeat(32)]: "DuskEVM brand new contract",
        ["ef".repeat(32)]: "DuskEVM system config",
      });
      assert.equal(generated.chainId, 745);
      assert.equal(labelOf("evm_tx_router"), "DuskEVM transaction router");

      const merged = merge(networks.testnet, generated);
      const labels = merged.display.labels;

      // The old DuskEVM labels go, the new ones come, the others stay.
      assert.equal(labels["2257e5f8ff49cf7c9704a14ca35acbf48eb7ade11a079d98d5cd5655eea1b31d"], undefined);
      assert.equal(labels["ab".repeat(32)], "DuskEVM bridge portal");
      assert.equal(labels[`01${"0".repeat(62)}`], "Transfer contract");
      assert.equal(merged.duskEvm.name, "DuskEVM Testnet");
      assert.deepEqual(Object.keys(merged.duskEvm), [
        "name", "chainId", "currency", "rpcUrl", "explorerUrl", "blockscoutApiUrl", "predeploys", "drivers", "contracts", "source",
      ]);
    } finally {
      checkout.remove();
    }
  });

  it("refuses a checkout that lacks the portal or the system config, on either side", () => {
    for (const drop of [
      ["deposit_contract_address", "optimism_portal"],
      ["l1_system_config_address", "system_config", "transparent_proxy"],
      ["deposit_contract_address"],
      ["system_config", "transparent_proxy"],
      // Nothing at all: it would have made an empty contract set.
      ["deposit_contract_address", "l1_system_config_address", "brand_new_contract", "optimism_portal", "system_config", "transparent_proxy"],
    ]) {
      const checkout = genesis({ drop });

      try {
        assert.throws(() => generate(checkout.dir, "testnet", networks.testnet), undefined, drop.join(", "));
      } finally {
        checkout.remove();
      }
    }
  });

  it("refuses a checkout whose files aren't one set, or for another chain", () => {
    for (const options of [{ l1ChainId: 3 }, { deposit: SYSTEM_CONFIG }]) {
      const checkout = genesis(options);

      try {
        assert.throws(() => generate(checkout.dir, "testnet", networks.testnet));
      } finally {
        checkout.remove();
      }
    }
  });

  // A duskevm-genesis checkout, where DUSKEVM_GENESIS_DIR names one.
  const checkout = process.env.DUSKEVM_GENESIS_DIR ?? "";

  it("matches the duskevm-genesis checkout", { skip: !checkout && "DUSKEVM_GENESIS_DIR isn't set" }, () => {
    assert.ok(existsSync(join(checkout, "testnet")), checkout);
    assert.equal(main([checkout, "--check"]), 0);
  });
});
