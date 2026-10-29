import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import fixtures from "./fixtures/duskevm-bridge-calls.json" with { type: "json" };
import {
  BRIDGE_FUNCTIONS,
  DEPOSIT_MIN_GAS_LIMIT,
  bridgeEnvelopeOk,
  decodeBridgeCall,
  decodeWithdrawal,
  depositCall,
  duskEvmContracts,
  duskRecipientOf,
  encodeDepositArgs,
  evmAddressOf,
  isBridgeContract,
} from "../src/duskevm.js";
import { networks } from "../src/index.js";

// The calls the apps' tests decode, made with the bridge's encoder and its
// pinned OptimismPortal data driver, and two sent on testnet as they were
// (fixtures.note). `expected` is what the extension's and the web wallet's
// decoders read from them, and the web wallet's withdrawal hash.
const { testnet, mainnet, devnet } = networks;
const { bridge, portal } = /** @type {NonNullable<ReturnType<typeof duskEvmContracts>>} */ (duskEvmContracts(testnet));

/** @param {string} hex */
const bytes = (hex) => Uint8Array.from(hex.replace(/^0x/, "").match(/../g) ?? [], (b) => parseInt(b, 16));

/** @param {Uint8Array} b */
const hex = (b) => Buffer.from(b).toString("hex");

/** @param {string} name */
const call = (name) => {
  const found = fixtures.calls.find((c) => c.name === name);

  if (!found) throw new Error(`No fixture ${name}`);

  return found;
};

/** @param {string} fnName */
const contractOf = (fnName) => (fnName === BRIDGE_FUNCTIONS.deposit ? bridge : portal);

/**
 * @param {string} name
 * @param {Record<string, unknown>} [over]
 */
const decode = (name, over = {}) => {
  const c = call(name);

  return decodeBridgeCall(testnet, { args: c.args, contractId: contractOf(c.fnName), fnName: c.fnName, ...over });
};

/**
 * The facts as the fixture writes them: bigints as strings, the nonce in hex.
 *
 * @param {import("../src/duskevm.js").BridgeCall | null} out
 */
const asWritten = (out) =>
  out &&
  JSON.parse(
    JSON.stringify(out, (key, value) =>
      typeof value === "bigint" ? (key === "nonce" ? `0x${value.toString(16).padStart(64, "0")}` : String(value)) : value
    )
  );

/**
 * A call's arguments changed by `edit`, decoded.
 *
 * @param {string} name
 * @param {(args: Uint8Array) => Uint8Array | void | number} edit
 */
const tamper = (name, edit) => {
  const c = call(name);
  const args = bytes(c.args);
  const out = edit(args);

  return decodeBridgeCall(testnet, {
    args: out instanceof Uint8Array ? out : args,
    contractId: contractOf(c.fnName),
    fnName: c.fnName,
  });
};

/**
 * Where `seq` first is in `b`.
 *
 * @param {Uint8Array} b
 * @param {number[]} seq
 */
const find = (b, seq) => b.findIndex((_, i) => seq.every((x, j) => b[i + j] === x));

/**
 * Where finalizeBridgeETH's second address, `to`, is in a call's arguments.
 *
 * @param {Uint8Array} args
 */
const toAt = (args) => find(args, [0x16, 0x35, 0xf5, 0xfd]) + 4 + 32 + 12;

/** @param {bigint} n A u256, as the bridge writes one: 32 bytes, big-endian. */
const word = (n) => bytes(n.toString(16).padStart(64, "0"));

/**
 * `bytes` with every 32-byte word `from` made `to`; how many there were.
 *
 * @param {Uint8Array} b
 * @param {bigint} from
 * @param {bigint} to
 */
function replaceWord(b, from, to) {
  const out = Uint8Array.from(b);
  const [old, next] = [word(from), word(to)];
  let count = 0;

  for (let at = find(out, Array.from(old)); at > -1; at = find(out, Array.from(old))) {
    out.set(next, at);
    count += 1;
  }

  return { count, out };
}

/**
 * A withdrawal's call with its amount changed in each place it's written:
 * the withdrawal, the relay and the bridge's message.
 *
 * @param {string} name
 * @param {bigint} wei
 */
const withAmount = (name, wei) => {
  const c = call(name);
  const was = BigInt(/** @type {{ amountWei: string }} */ (c.expected).amountWei);
  const { count, out } = replaceWord(bytes(c.args), was, wei);

  assert.equal(count, 3, name);

  return decode(name, { args: out });
};

describe("DuskEVM's contracts on Dusk", () => {
  it("are the network file's, on the networks with DuskEVM", () => {
    assert.deepEqual(duskEvmContracts(testnet), {
      anchorStateRegistry: "1735498c11978854e390894502850916f4ba619e3f4b88c10ef758c5026619cc",
      bridge: "2257e5f8ff49cf7c9704a14ca35acbf48eb7ade11a079d98d5cd5655eea1b31d",
      disputeGameFactory: "3b7d562aa0e6b94ce29c5ce2a6f0587ad771afdace86abb0baf66f93e49548cd",
      messenger: "63cd2c93016296b2ec357e31fd44b716cf2cda3b31217d45087f17ccc6440530",
      portal: "14eeb3d4021aff09af2c515603a01f8d956a7f6411d11a1b1c0b0561a93fb1b9",
    });
    assert.equal(duskEvmContracts(2), duskEvmContracts(testnet));
    assert.ok(Object.isFrozen(duskEvmContracts(testnet)));
    assert.equal(duskEvmContracts(mainnet), null);
    assert.equal(duskEvmContracts(devnet), null);
    assert.throws(() => duskEvmContracts(41), TypeError);
  });

  it("tell a call to the bridge or the Portal, decoded or not", () => {
    assert.equal(isBridgeContract(testnet, portal), true);
    assert.equal(isBridgeContract(testnet, `0x${bridge.toUpperCase()}`), true);
    assert.equal(isBridgeContract(testnet, "ab".repeat(32)), false);
    assert.equal(isBridgeContract(testnet, undefined), false);
    assert.equal(isBridgeContract(mainnet, portal), false);
  });

  it("have the EVM addresses DuskEVM gives them: their IDs' keccak-256, the last 20 bytes", () => {
    const evm = /** @type {NonNullable<typeof testnet.duskEvm>} */ (testnet.duskEvm);

    // Dusk's bridge as DuskEVM names it, and its messenger, as the route has them.
    assert.equal(evmAddressOf(bridge), fixtures.route.l1Bridge);
    assert.equal(evmAddressOf(`0x${bridge.toUpperCase()}`), "0x2D2e08C0E8d64381Db56bF2c942Bc825602E61C3");
    assert.equal(evmAddressOf(evm.contracts.l1_cross_domain_messenger.contractId), fixtures.route.l1Messenger);

    for (const [name, { contractId, evmAddress }] of Object.entries(evm.contracts)) {
      // A proxy's address is the one DuskEVM was given, not its ID's.
      if (!["system_config", "system_config_legacy", "transparent_proxy"].includes(name)) {
        assert.equal(evmAddressOf(contractId), evmAddress, name);
      }
    }

    assert.throws(() => evmAddressOf("not an id"), TypeError);
  });

  it("give an account the address the Portal keeps its proofs by: its raw key's keccak-256, the last 20 bytes", () => {
    // As the bridge's duskAccountEvmAddress and the web wallet's proof
    // submitter work it out.
    assert.equal(
      evmAddressOf("21n5ncyuJkRr9JRoxvWRLMcqcWxmVSSLdefDMTwQeNyZZikU5dcXuawf9kNuG1CxFvz32oBM965PQ2PCcWrwX8YX9a7fqaaQ6fabDhxW5mveEyAt4LgdY3KLH9iKtSfMMLNz").toLowerCase(),
      "0x975729af8e43f9d690d24da68d9e92d2e8273174"
    );
    // alice.dusk's, the `from` of her testnet deposit's eth_bridge_initiated event.
    assert.equal(
      evmAddressOf("qxwSidLBa1rJ74ngfP4GUCaNsAYjMboDPHzbmiVEMmNNK26hVkYe8QccH6ipYdVRsUDnx9QS1KBeu8ZoMDFpXJJE6YCcHy2AykvJ7eEAGc7PGDgCZFV5YJBxzukADkQ2Bgr").toLowerCase(),
      "0x69d527749c90620ee9ee7d17fd8d4dec74e3a9a8"
    );
    assert.throws(() => evmAddressOf(`${String(call("claim-account").expected.recipient.account).slice(0, -1)}1`), TypeError);
  });
});

describe("the bridge's calls", () => {
  it("are the fixtures the apps have, byte for byte", () => {
    for (const c of fixtures.calls) {
      assert.equal(createHash("sha256").update(bytes(c.args)).digest("hex"), c.sha256, c.name);
    }

    assert.equal(fixtures.network, "testnet");
    assert.equal(fixtures.portalDriverSha256, testnet.duskEvm?.drivers.optimismPortal.sha256);
    assert.deepEqual(fixtures.route, {
      l1Bridge: testnet.duskEvm?.contracts.l1_standard_bridge.evmAddress,
      l1Messenger: testnet.duskEvm?.contracts.l1_cross_domain_messenger.evmAddress,
      l2Bridge: testnet.duskEvm?.predeploys.l2StandardBridge,
      l2Messenger: testnet.duskEvm?.predeploys.l2CrossDomainMessenger,
    });
  });

  it("read each one as the apps do", () => {
    for (const c of fixtures.calls) {
      assert.deepEqual(asWritten(decode(c.name)), c.expected, c.name);
    }
  });

  it("read a deposit's DuskEVM address and amount, as the node gives the call, in hex or bytes", () => {
    for (const name of ["deposit", "deposit-shoot", "deposit-archive", "deposit-explorer"]) {
      const c = call(name);

      assert.deepEqual(decode(name, { args: bytes(c.args) }), decode(name));
      assert.deepEqual(decode(name, { args: `0x${c.args.toUpperCase()}` }), decode(name));
    }

    assert.deepEqual(decode("deposit-explorer"), {
      amountLux: 500_000_000n,
      extraDataBytes: 0,
      kind: "deposit",
      minGasLimit: 200_000,
      recipient: "0x5A3d8e1B7c2f4A6b9e0D1C3f5A7b9C2D4e6F8a01",
    });
  });

  it("give a withdrawal's proof and its claims the same nonce and hash, and another withdrawal others", () => {
    /** @param {string} name */
    const of = (name) => {
      const out = decode(name);

      return out && out.kind !== "deposit" ? [out.nonce, out.hash] : null;
    };

    assert.deepEqual(of("claim-account"), of("prove-account"));
    assert.deepEqual(of("claim-external-account"), of("prove-account"));
    assert.deepEqual(of("claim-contract-canonical"), of("prove-contract-canonical"));
    assert.deepEqual(of("claim-external-contract-canonical"), of("prove-contract-canonical"));
    assert.notDeepEqual(of("prove-contract-canonical"), of("prove-account"));
    assert.ok(of("prove-contract-canonical"));
    // wallet-both.dusk's proof of withdrawal 41, its nonce version 1.
    assert.match(String(call("prove-wallet-both").expected.nonce), /^0x0001[0-9a-f]{58}29$/);
    assert.equal(call("prove-wallet-both").expected.hash, "0x8e2da35e948bd0a4ff16b0d6d3797be8e8ecb7402640de2e5c384282659ee4a0");
  });

  it("say whom a withdrawal pays on Dusk, an account or a contract, and who withdrew", () => {
    for (const name of ["prove-account", "claim-account", "claim-external-account"]) {
      assert.deepEqual(decode(name)?.kind !== "deposit" && decode(name)?.recipient, {
        account:
          "21n5ncyuJkRr9JRoxvWRLMcqcWxmVSSLdefDMTwQeNyZZikU5dcXuawf9kNuG1CxFvz32oBM965PQ2PCcWrwX8YX9a7fqaaQ6fabDhxW5mveEyAt4LgdY3KLH9iKtSfMMLNz",
        kind: "account",
      });
    }

    for (const name of ["prove-contract-canonical", "claim-contract-canonical", "claim-external-contract-canonical"]) {
      const out = decode(name);

      assert.ok(out && out.kind !== "deposit");
      assert.deepEqual(out.recipient, { contractId: `21a5cb174bbd7dd0ae${"11".repeat(23)}`, kind: "contract" });
      assert.equal(out.from, "0xEFa73D0F1a0646A0222A9a2BE389a4EE6AC40A26");
    }

    // A claim with another's proof names its submitter; a proof, its game and nodes.
    assert.deepEqual(
      [decode("claim-external-account"), decode("prove-account")].map((out) =>
        out?.kind === "claim" ? out.proofSubmitter : out?.kind === "prove" ? [out.disputeGameIndex, out.proofNodes] : null
      ),
      ["0x5555555555555555555555555555555555555555", [42n, 3]]
    );
    assert.equal("proofSubmitter" in /** @type {object} */ (decode("claim-account")), false);
  });

  it("decode nothing off the bridge's own network and contracts", () => {
    const deposit = call("deposit");

    assert.notEqual(decode("deposit"), null);
    // Mainnet and devnet have no DuskEVM yet; a chain without a file throws, as everywhere.
    assert.equal(decodeBridgeCall(mainnet, { args: deposit.args, contractId: bridge, fnName: deposit.fnName }), null);
    assert.equal(decodeBridgeCall(devnet, { args: deposit.args, contractId: bridge, fnName: deposit.fnName }), null);
    assert.throws(() => decodeBridgeCall(0, { args: deposit.args, contractId: bridge, fnName: deposit.fnName }), TypeError);
    assert.equal(decode("deposit", { contractId: portal }), null);
    assert.equal(decode("deposit", { contractId: `0x${"ab".repeat(32)}` }), null);
    assert.equal(decode("deposit", { contractId: undefined }), null);
    assert.equal(decode("deposit", { fnName: "depositETH" }), null);
    assert.equal(decode("deposit", { fnName: "deposit" }), null);
    assert.notEqual(decode("deposit", { contractId: `0x${bridge.toUpperCase()}` }), null);
    assert.equal(decode("prove-account", { fnName: BRIDGE_FUNCTIONS.claim }), null);
    assert.equal(decode("claim-account", { contractId: bridge }), null);
  });

  it("take a function by its exact name, as Dusk dispatches it", () => {
    const deposit = call("deposit");

    for (const fnName of [` ${deposit.fnName} `, `${deposit.fnName} `, `\t${deposit.fnName}`, deposit.fnName.toLowerCase()]) {
      assert.equal(decode("deposit", { fnName }), null, JSON.stringify(fnName));
    }

    assert.equal(decode("prove-account", { fnName: ` ${BRIDGE_FUNCTIONS.prove}` }), null);
    assert.equal(decode("claim-account", { fnName: `${BRIDGE_FUNCTIONS.claim}\n` }), null);
    assert.equal(decode("claim-external-account", { fnName: ` ${BRIDGE_FUNCTIONS.claimWithProofOf} ` }), null);
    assert.notEqual(decode("deposit", { fnName: deposit.fnName }), null);
  });

  it("pay a contract only at the address DuskEVM gives it, as Dusk's L1 bridge requires of a credit", () => {
    // The extension's credits pay 0x2222…: Dusk's L1 bridge refuses them.
    for (const name of ["prove-contract", "claim-contract", "claim-external-contract"]) {
      const args = bytes(call(name).args);

      assert.equal(hex(args.subarray(toAt(args), toAt(args) + 20)), "22".repeat(20), name);
      assert.equal(decode(name), null, name);
      assert.notEqual(decode(`${name}-canonical`), null, `${name}-canonical`);
      // One bit of `to` off, and it's refused again.
      assert.equal(tamper(`${name}-canonical`, (a) => (a[toAt(a) + 19] ^= 1)), null, `${name}-canonical, another to`);
    }

    // wallet-both.dusk's, sent on testnet, pays its contract's address.
    const sent = bytes(call("prove-wallet-both").args);

    assert.equal(`0x${hex(sent.subarray(toAt(sent), toAt(sent) + 20))}`, evmAddressOf("21a5cb174bbd7dd0ae1c5bb76c989bb62fb82354aeec9fb25f548c43677dedd0").toLowerCase());
    assert.notEqual(decode("prove-wallet-both"), null);
    // An account's `to` isn't checked: the bridge pays the account its extra data names.
    assert.notEqual(decode("claim-account"), null);
  });

  it("pay a contract whole lux only, and no one more lux than a u64 holds, as Dusk's L1 bridge does", () => {
    const LUX = 10n ** 9n;

    // A contract credit: exact, and at most a u64.
    assert.notEqual(withAmount("prove-wallet-both", 2n * 10n ** 18n), null);
    assert.equal(withAmount("prove-wallet-both", 10n ** 18n + 1n), null);
    assert.equal(withAmount("prove-wallet-both", 10n ** 18n + LUX - 1n), null);
    assert.notEqual(withAmount("prove-wallet-both", (2n ** 64n - 1n) * LUX), null);
    assert.equal(withAmount("prove-wallet-both", 2n ** 64n * LUX), null);
    assert.equal(withAmount("claim-external-contract-canonical", 10n ** 18n + 1n), null);
    // An account keeps the dust past whole lux, but not more lux than a u64 holds.
    assert.equal(withAmount("claim-account", 1008n * 10n ** 18n + 1n)?.kind, "claim");
    assert.notEqual(withAmount("claim-account", (2n ** 64n - 1n) * LUX + LUX - 1n), null);
    assert.equal(withAmount("claim-account", 2n ** 64n * LUX), null);
    assert.equal(withAmount("prove-account", 2n ** 64n * LUX), null);
  });

  it("decode nothing that differs from what the bridge encodes", () => {
    const root = (/** @type {Uint8Array} */ args, /** @type {number} */ size) => args.length - size;

    // Arguments that aren't bytes or hex, too short, a byte more, or extra
    // data that isn't there.
    for (const args of [undefined, "", "0", "zz", { bad: 1 }, [0, 1], `${call("deposit").args}00`, call("deposit").args.slice(0, 20)]) {
      assert.equal(decode("deposit", { args }), null, JSON.stringify(args));
    }

    assert.equal(tamper("deposit", (a) => a.subarray(0, 39)), null);
    assert.equal(tamper("deposit", (a) => (a[36] = 5)), null);
    assert.equal(tamper("deposit-explorer", (a) => a.subarray(1)), null);
    assert.equal(tamper("deposit-explorer", (a) => (a[36] = 1)), null);
    // The withdrawal's data pointing elsewhere, an amount that differs from
    // the one the relayed message pays, a claim cut short, and a proof longer
    // than the buffer.
    assert.equal(tamper("claim-account", (a) => (a[root(a, 144) + 96] = 0x7f)), null);
    assert.equal(tamper("claim-account", (a) => (a[root(a, 144) + 63] ^= 1)), null);
    assert.equal(decode("claim-account", { args: call("claim-account").args.slice(0, -2) }), null);
    assert.equal(tamper("prove-account", (a) => (a[a.length - 4] = 0xff)), null);
    // The relayed call must be the bridge's: another selector is unknown.
    assert.equal(tamper("claim-account", (a) => (a[0] ^= 0xff)), null);
    // A recipient in an unknown format is not shown as one.
    assert.equal(tamper("claim-contract-canonical", (a) => (a[find(a, [0x20, 0x01, 0x21, 0xa5])] = 0x21)), null);
    // Untouched, they decode.
    assert.notEqual(tamper("claim-contract-canonical", () => {}), null);
    assert.notEqual(tamper("prove-account", () => {}), null);
  });

  it("decode a withdrawal only on the bridge's route: messenger to messenger, relaying bridge to bridge", () => {
    for (const name of ["claim-account", "prove-account", "claim-external-contract-canonical", "prove-wallet-both"]) {
      assert.notEqual(decode(name), null, name);

      // The withdrawal's sender and target, and the relayed call's sender and target.
      for (const [part, address] of Object.entries(fixtures.route)) {
        const args = bytes(call(name).args);
        const at = find(args, Array.from(bytes(address.toLowerCase())));

        assert.ok(at > -1, `${name}: ${part}`);
        args[at + 19] ^= 1;
        assert.equal(decode(name, { args }), null, `${name} with another ${part}`);
      }
    }

    // A network whose file names another bridge: its withdrawals relay to that one.
    const evm = /** @type {NonNullable<typeof testnet.duskEvm>} */ (testnet.duskEvm);
    const otherBridge = {
      ...testnet,
      duskEvm: {
        ...evm,
        contracts: {
          ...evm.contracts,
          l1_standard_bridge: { contractId: "cd".repeat(32), evmAddress: /** @type {`0x${string}`} */ (`0x${"cd".repeat(20)}`) },
        },
      },
    };

    assert.equal(decodeBridgeCall(otherBridge, { args: call("prove-account").args, contractId: portal, fnName: BRIDGE_FUNCTIONS.prove }), null);

    // And one without its messenger, whose route can't be checked.
    const { l1_cross_domain_messenger: _, ...rest } = evm.contracts;
    const noMessenger = { ...testnet, duskEvm: { ...evm, contracts: rest } };

    assert.equal(decodeBridgeCall(noMessenger, { args: call("claim-account").args, contractId: portal, fnName: BRIDGE_FUNCTIONS.claim }), null);
    assert.notEqual(decodeBridgeCall(noMessenger, { args: call("deposit").args, contractId: bridge, fnName: BRIDGE_FUNCTIONS.deposit }), null);
  });
});

describe("a withdrawal as DuskEVM recorded it", () => {
  // wallet-both.dusk's withdrawal 41, as DuskEVM's MessagePassed event gives it.
  const passed = fixtures.messagePassed;
  const proof = /** @type {import("../src/duskevm.js").ProveCall} */ (decode("prove-wallet-both"));
  const { disputeGameIndex: _, kind: __, proofNodes: ___, ...facts } = proof;

  it("reads as its proof does, with its numbers in any form", () => {
    assert.deepEqual(decodeWithdrawal(testnet, passed), facts);
    assert.deepEqual(
      decodeWithdrawal(testnet, {
        ...passed,
        data: bytes(passed.data),
        gasLimit: Number(passed.gasLimit),
        nonce: BigInt(passed.nonce),
        sender: passed.sender.toUpperCase().replace(/^0X/, "0x"),
        value: `0x${BigInt(passed.value).toString(16)}`,
      }),
      facts
    );
  });

  it("pays a contract only at its address, and only whole lux, as Dusk's L1 bridge does", () => {
    const data = bytes(passed.data);
    const to = Uint8Array.from(data);

    to[toAt(to) + 19] ^= 1;
    assert.equal(decodeWithdrawal(testnet, { ...passed, data: to }), null);

    const inexact = replaceWord(data, 10n ** 18n, 10n ** 18n + 1n);

    assert.equal(inexact.count, 2);
    assert.equal(decodeWithdrawal(testnet, { ...passed, data: inexact.out, value: 10n ** 18n + 1n }), null);

    const exact = replaceWord(data, 10n ** 18n, 3n * 10n ** 18n);

    assert.equal(decodeWithdrawal(testnet, { ...passed, data: exact.out, value: 3n * 10n ** 18n })?.amountWei, 3n * 10n ** 18n);
  });

  it("is no bridge withdrawal from another sender or to another target, of another amount, or paying no one known", () => {
    for (const over of [
      { sender: `0x${"11".repeat(20)}` },
      { target: `0x${"11".repeat(20)}` },
      { value: "1" },
      { value: "-1" },
      { nonce: 2n ** 256n },
      { gasLimit: 1.5 },
      { data: passed.data.slice(0, -64) },
      { data: "zz" },
      { sender: undefined },
    ]) {
      assert.equal(decodeWithdrawal(testnet, { ...passed, ...over }), null, JSON.stringify(over, (_, v) => (typeof v === "bigint" ? String(v) : v)));
    }

    assert.equal(decodeWithdrawal(mainnet, passed), null);
    assert.equal(decodeWithdrawal(testnet, /** @type {any} */ (null)), null);
  });
});

describe("whom a withdrawal's extra data pays on Dusk", () => {
  const PAID =
    "21n5ncyuJkRr9JRoxvWRLMcqcWxmVSSLdefDMTwQeNyZZikU5dcXuawf9kNuG1CxFvz32oBM965PQ2PCcWrwX8YX9a7fqaaQ6fabDhxW5mveEyAt4LgdY3KLH9iKtSfMMLNz";
  // As the DuskEVM SDK's encodeDuskExternalAssetRecipient writes it: tag 2,
  // version 1, kind 0, then the raw key (the explorer's vector).
  const RAW =
    "6717a02bc6933ffe261f47a3b239e4b323d7d73149c3e24e442939bd297a6572ecf635f40eeac8f37f2f06d605da970a32c128aa29b671b5368038ed4cb53e7a150275675add2045271410e4f0f2b4a9ed192a1d9691aa7a3efdb8f6798bbf030117554df0051bd2b65e8dce5547b56cd1993be64590b6a4b61dd8c275c87de0d22667291264984fcf1546dcb8d8c800830edc4a813bd9d3c3822bec934d8a22ee3898d3256d4fa67bb0a71879d0fc9f7c5442293ecbbf9ded9475428e114d0400";

  it("is an account, from its raw key, or a contract, from a credit with a payload", () => {
    assert.deepEqual(duskRecipientOf(`0x020100${RAW}`), { account: PAID, kind: "account" });
    assert.deepEqual(duskRecipientOf(bytes(`020100${RAW}`)), { account: PAID, kind: "account" });
    // The shape of testnet withdrawal 0x6ae8c4cb…: tag 32, version 1, the contract ID, a payload.
    assert.deepEqual(duskRecipientOf(`0x2001${"21a5".repeat(16)}${"00".repeat(64)}`), { contractId: "21a5".repeat(16), kind: "contract" });
    assert.deepEqual(duskRecipientOf(`0x2001${"21a5".repeat(16)}`), { contractId: "21a5".repeat(16), kind: "contract" });
  });

  it("is no one for anything else", () => {
    for (const extraData of [
      "0x",
      "0x0201",
      `0x020101${"11".repeat(32)}`,
      `0x020101${RAW}`,
      `0x020100${RAW.slice(0, -2)}`,
      `0x020100${RAW.slice(0, -2)}01`,
      `0x020100${"ff".repeat(193)}`,
      `0x2001${"00".repeat(32)}`,
      `0x2002${"21a5".repeat(16)}`,
      "zz",
      undefined,
    ]) {
      assert.equal(duskRecipientOf(extraData), null, String(extraData).slice(0, 12));
    }
  });
});

describe("bridgeEnvelopeOk", () => {
  const deposit = /** @type {import("../src/duskevm.js").DepositCall} */ ({ amountLux: 100_000_000n, extraDataBytes: 0, kind: "deposit", minGasLimit: 200_000, recipient: "0x00" });
  const prove = /** @type {import("../src/duskevm.js").ProveCall} */ (/** @type {unknown} */ ({ amountWei: 10n ** 18n, kind: "prove" }));
  const own = ["own-account", "own-address"];

  it("takes a deposit that moves its bridged amount as the deposit, and nothing else", () => {
    assert.equal(bridgeEnvelopeOk(deposit, { amount: "0", deposit: "100000000" }), true);
    assert.equal(bridgeEnvelopeOk(deposit, { deposit: 100_000_000n, own, to: "own-account" }), true);
    assert.equal(bridgeEnvelopeOk(deposit, { deposit: 100_000_000 }), true);
    assert.equal(bridgeEnvelopeOk(deposit, { amount: "1", deposit: "100000000" }), false);
    assert.equal(bridgeEnvelopeOk(deposit, { deposit: "200000000" }), false);
    assert.equal(bridgeEnvelopeOk(deposit, { deposit: "100000000", own, to: "someone" }), false);
    assert.equal(bridgeEnvelopeOk(deposit, { deposit: "not a number" }), false);
    assert.equal(bridgeEnvelopeOk(deposit, {}), false);
  });

  it("takes a proof or a claim that moves nothing", () => {
    assert.equal(bridgeEnvelopeOk(prove, {}), true);
    assert.equal(bridgeEnvelopeOk({ ...prove, kind: "claim" }, { amount: "0", deposit: "0", own, to: "own-address" }), true);
    assert.equal(bridgeEnvelopeOk(prove, { deposit: "1" }), false);
    assert.equal(bridgeEnvelopeOk(prove, { amount: "1" }), false);
    assert.equal(bridgeEnvelopeOk(prove, { to: "someone" }), false);
    assert.equal(bridgeEnvelopeOk(null, {}), false);
  });

  it("names a deposit's DuskEVM address only when it's sent as the bridge expects, as the explorer and the extension show it", () => {
    const { args, expected } = call("deposit-explorer");
    const recipientOf = (/** @type {{ amount?: unknown, deposit?: unknown, contractId?: string, chain?: number }} */ tx) => {
      const out = decodeBridgeCall(tx.chain ?? 2, { args, contractId: tx.contractId ?? bridge, fnName: BRIDGE_FUNCTIONS.deposit });

      return out?.kind === "deposit" && bridgeEnvelopeOk(out, tx) ? out.recipient : null;
    };

    assert.equal(recipientOf({ amount: 0, deposit: 500_000_000 }), expected.recipient);
    assert.equal(recipientOf({ amount: 0, deposit: 400_000_000 }), null);
    assert.equal(recipientOf({ amount: 1, deposit: 500_000_000 }), null);
    assert.equal(recipientOf({ chain: 1, deposit: 500_000_000 }), null);
    assert.equal(recipientOf({ contractId: portal, deposit: 500_000_000 }), null);
  });
});

describe("a deposit's arguments", () => {
  it("are rkyv, as duskevm-contracts writes them, with or without extra data", () => {
    for (const vector of fixtures.encodings) {
      const args = encodeDepositArgs({
        amountLux: BigInt(vector.amountLux),
        extraData: Array.from(bytes(vector.extraData)),
        minGasLimit: vector.minGasLimit,
        to: vector.to,
      });

      assert.equal(hex(args), vector.args, vector.name);
      assert.deepEqual(
        decodeBridgeCall(testnet, { args, contractId: bridge, fnName: BRIDGE_FUNCTIONS.deposit }),
        {
          amountLux: BigInt(vector.amountLux),
          extraDataBytes: bytes(vector.extraData).length,
          kind: "deposit",
          minGasLimit: vector.minGasLimit,
          recipient: vector.to,
        },
        vector.name
      );
    }
  });

  it("read back as the bridge sent them, and from after extra data", () => {
    const { expected } = call("deposit");
    const args = encodeDepositArgs({ amountLux: 100_000_000n, to: String(expected.recipient) });

    assert.equal(hex(args), call("deposit").args);

    const withExtra = new Uint8Array(48);

    withExtra.set(encodeDepositArgs({ amountLux: 7n, minGasLimit: 1, to: String(expected.recipient) }), 8);
    assert.equal(decodeBridgeCall(testnet, { args: withExtra, contractId: bridge, fnName: BRIDGE_FUNCTIONS.deposit })?.kind, "deposit");

    // rkyv aligns the root to 8: one after 4 bytes isn't the bridge's, though its pointer is in bounds.
    const misaligned = new Uint8Array(44);

    misaligned.set(encodeDepositArgs({ amountLux: 7n, minGasLimit: 1, to: String(expected.recipient) }), 4);
    assert.equal(decodeBridgeCall(testnet, { args: misaligned, contractId: bridge, fnName: BRIDGE_FUNCTIONS.deposit }), null);
  });

  it("leave the call on DuskEVM the DuskEVM SDK's default gas, 200,000", () => {
    assert.equal(DEPOSIT_MIN_GAS_LIMIT, 200_000);

    const args = encodeDepositArgs({ amountLux: 1n, to: "0x1111111111111111111111111111111111111111" });

    assert.equal(new DataView(args.buffer).getUint32(args.length - 40 + 28, true), 200_000);
  });

  it("refuse an amount or a gas limit out of range, and a recipient or extra data that isn't one", () => {
    const to = "0x1111111111111111111111111111111111111111";

    for (const [deposit, error] of /** @type {const} */ ([
      [{ amountLux: 2n ** 64n, minGasLimit: 150_000, to }, RangeError],
      [{ amountLux: 0n, to }, RangeError],
      [{ amountLux: -1n, to }, RangeError],
      [{ amountLux: 123n, minGasLimit: 2 ** 32, to }, RangeError],
      [{ amountLux: 123n, minGasLimit: -1, to }, RangeError],
      [{ amountLux: 1.5, to }, TypeError],
      [{ amountLux: 123n, minGasLimit: 1.5, to }, TypeError],
      [{ amountLux: 123n, extraData: /** @type {any} */ ("not bytes"), to }, TypeError],
      [{ amountLux: 123n, to: "0x11111111111111111111111111111111111111" }, TypeError],
      // Mixed case is a checksum, and this one is wrong.
      [{ amountLux: 123n, to: "0x3e5B8223e638CB414BEF8CF95393460cA1C3a11d" }, TypeError],
    ])) {
      assert.throws(() => encodeDepositArgs(deposit), error, JSON.stringify(deposit, (_, v) => (typeof v === "bigint" ? String(v) : v)));
    }

    assert.equal(encodeDepositArgs({ amountLux: "5", to: to.toUpperCase().replace(/^0X/, "0x") }).length, 40);
  });

  it("go to the network's bridge, which they send the amount along to", () => {
    const to = "0x3E5B8223e638CB414BEF8CF95393460cA1C3a11d";
    const made = depositCall(testnet, { amountLux: 100_000_000n, to });

    assert.deepEqual(made, {
      contractId: bridge,
      deposit: 100_000_000n,
      fnArgs: bytes(call("deposit").args),
      fnName: "depositETHToWithValue",
    });
    assert.equal(depositCall(mainnet, { amountLux: 1n, to }), null);

    const sent = decodeBridgeCall(testnet, { args: made?.fnArgs, contractId: made?.contractId, fnName: made?.fnName });

    assert.equal(bridgeEnvelopeOk(sent, { amount: 0n, deposit: made?.deposit }), true);
  });
});
