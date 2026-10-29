import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { accountToRawKey, decodeBase58, encodeBase58, isAccount, rawKeyToAccount } from "../src/account.js";
import { networks } from "../src/index.js";

/** @param {string} hex */
const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

/** @param {Uint8Array} b */
const hex = (b) => Buffer.from(b).toString("hex");

// The explorer's vectors: testnet accounts and `balance_of`'s argument for
// them, as Sozu's stDUSK data driver encodes it, the `Account::External` tag,
// 1, then the raw key. The first sorts its y as the smaller root, the second
// as the larger.
const VECTORS = [
  [
    "qxwSidLBa1rJ74ngfP4GUCaNsAYjMboDPHzbmiVEMmNNK26hVkYe8QccH6ipYdVRsUDnx9QS1KBeu8ZoMDFpXJJE6YCcHy2AykvJ7eEAGc7PGDgCZFV5YJBxzukADkQ2Bgr",
    "017de9fd978ecfba13d6e3e50a66e183ec04b9fd33eda7fefa60e0a2e731ade06946836da658f9583e122c49877ec8fe186ca73fbfa8325345f95624c7d6421403a92783ebfb77f59353179aabcec54d853b4da3116032525096ced451a6899f081c28a0bd0ee4fc5a5500f55cdc73aa9a7bdb0a6cf7862a79d7415376ed909044bc813180b9d2f883416bdaa8264d2c15c9f681614322403cd49c3b3cdc3244eda993d911eae2e9297560d02e180e3ffb56a7748c298b7bf0874eaf867e73660400",
  ],
  [
    "21n5ncyuJkRr9JRoxvWRLMcqcWxmVSSLdefDMTwQeNyZZikU5dcXuawf9kNuG1CxFvz32oBM965PQ2PCcWrwX8YX9a7fqaaQ6fabDhxW5mveEyAt4LgdY3KLH9iKtSfMMLNz",
    "016717a02bc6933ffe261f47a3b239e4b323d7d73149c3e24e442939bd297a6572ecf635f40eeac8f37f2f06d605da970a32c128aa29b671b5368038ed4cb53e7a150275675add2045271410e4f0f2b4a9ed192a1d9691aa7a3efdb8f6798bbf030117554df0051bd2b65e8dce5547b56cd1993be64590b6a4b61dd8c275c87de0d22667291264984fcf1546dcb8d8c800830edc4a813bd9d3c3822bec934d8a22ee3898d3256d4fa67bb0a71879d0fc9f7c5442293ecbbf9ded9475428e114d0400",
  ],
];

// The web wallet's: BLS12-381's G2 generator, compressed, and as
// dusk_bls12_381's `G2Affine::generator().to_raw_bytes()` gives it.
const COMPRESSED_G2_GENERATOR =
  "93e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8";
const RAW_G2_GENERATOR =
  "100a9402a28ff2f51a96b48726fbf5b380e52a3eb593a8a1e9ae3c1a9d9994986b36631863b7676fd7bc50439291810506f6239e75c0a9a5c360cdbc9dc5a0aa067886e2187eb13b67b34185ccb61a1b478515f20eedb6c2f3ed6073092a92114a4c4960f80a734c5a9c365e1ffa7c595a630aaa6c85e6e75f490d6ee9b5efbba225eff075a9d307e5da807e8efd83005db064df92fcc0addc61142b0a27aa18a0ebe43b6aacad863aa33dc94e5c4979edca3ca4505817e7f21bde63a1c22b0b00";

// The bridge's: the BSC and Sepolia bridge accounts, a testnet account, and
// a withdrawal's recipient.
const ACCOUNTS = [
  networks.mainnet.routes.services[0].account,
  networks.testnet.routes.services[0].account,
  "24bfNr8MDUo5xJBecmeGzXDEraax4Cmbnhjyyt5GaL1Vbe6H48ZSYTpmjRDcFRDFzgzuePAPUNcdGMnBzBQBk4zAMgBCtPsY27tBJtKmB1st6qcmpzRR4Er5imxrzvMRnfWc",
  "21n5ncyuJkRr9JRoxvWRLMcqcWxmVSSLdefDMTwQeNyZZikU5dcXuawf9kNuG1CxFvz32oBM965PQ2PCcWrwX8YX9a7fqaaQ6fabDhxW5mveEyAt4LgdY3KLH9iKtSfMMLNz",
];

describe("base58", () => {
  it("reads back what it writes, leading zero bytes too", () => {
    for (const account of ACCOUNTS) {
      assert.equal(encodeBase58(/** @type {Uint8Array} */ (decodeBase58(account))), account);
    }

    assert.equal(encodeBase58([0, 0, 1]), "112");
    assert.equal(encodeBase58(new Uint8Array(0)), "");
    assert.deepEqual([...(decodeBase58("1112") ?? [])], [0, 0, 0, 1]);
    assert.deepEqual([...(decodeBase58(" 112\n") ?? [])], [0, 0, 1]);
  });

  it("refuses what isn't base58, and what isn't bytes", () => {
    for (const value of ["0", "O", "I", "l", " ", "", "0OIl", "acct+1", /** @type {any} */ (null), /** @type {any} */ (42)]) {
      assert.equal(decodeBase58(value), null, String(value));
    }

    assert.throws(() => encodeBase58([256]), TypeError);
    assert.throws(() => encodeBase58([1.5]), TypeError);
    assert.throws(() => encodeBase58(/** @type {any} */ ("ab")), TypeError);
  });

  it("decodes a 96-byte account and a 64-byte shielded address by their lengths", () => {
    const account =
      "M8vMuVUZZrHCW3LBFKEctWFJerYmT2HghQNuGHKrgV6BQqgkYK1A4FZLX3Nm9Rri63RZwL4gQCMhLyJRJQE5MQouqqu77Dr1rQnHqk1W7zAf4WKZqr6MgdxzkxFwFjo8ZM";
    const address = "2Ana1pUpv2ZbMVkwF5FXapYeBEjdxDatLn7nvJkhgTSXbs59SyZSx866bXirPgj8QQVB57uxHJBG1YFvkRbFj4T";

    assert.equal(decodeBase58(account)?.length, 96);
    assert.equal(decodeBase58(address)?.length, 64);
    // 96 bytes, but no key: its first byte doesn't mark it compressed.
    assert.equal(isAccount(account), false);
    assert.equal(isAccount(address), false);
  });
});

describe("accounts and their raw keys", () => {
  it("give an account's key as Sozu's data driver encodes it, and back", () => {
    for (const [account, args] of VECTORS) {
      const raw = /** @type {Uint8Array} */ (accountToRawKey(account));

      assert.equal(raw.length, 193);
      assert.equal(`01${hex(raw)}`, args);
      assert.equal(rawKeyToAccount(raw), account);
      assert.equal(rawKeyToAccount(bytes(args.slice(2))), account);
    }
  });

  it("give the G2 generator's raw bytes as dusk_bls12_381 writes them", () => {
    const account = encodeBase58(bytes(COMPRESSED_G2_GENERATOR));

    assert.equal(hex(/** @type {Uint8Array} */ (accountToRawKey(account))), RAW_G2_GENERATOR);
    assert.equal(rawKeyToAccount(bytes(RAW_G2_GENERATOR)), account);
  });

  it("read every account the apps' tests use back from its raw key", () => {
    for (const account of ACCOUNTS) {
      assert.ok(isAccount(account), account);
      assert.equal(rawKeyToAccount(/** @type {Uint8Array} */ (accountToRawKey(account))), account);
    }

    // Each network's blocklist and labelled accounts are keys too.
    for (const network of Object.values(networks)) {
      for (const { account } of network.display.blocklist) assert.ok(isAccount(account), account);
    }
  });

  it("take an account with spaces around it, as typed", () => {
    assert.equal(isAccount(`  ${ACCOUNTS[2]}  `), true);
    assert.equal(rawKeyToAccount(/** @type {Uint8Array} */ (accountToRawKey(` ${ACCOUNTS[2]}\n`))), ACCOUNTS[2]);
  });

  it("refuse bytes that aren't a key: Dusk checks the point, so DUSK sent there could never be spent", () => {
    const key = /** @type {Uint8Array} */ (decodeBase58(VECTORS[0][0]));
    /** @param {(bytes: Uint8Array) => void} change */
    const changed = (change) => {
      const copy = Uint8Array.from(key);

      change(copy);

      return encodeBase58(copy);
    };

    for (const [why, account] of [
      ["not an account", "not-a-dusk-account"],
      ["one byte", "1"],
      ["96 zero bytes", "1".repeat(96)],
      ["95 bytes", encodeBase58(key.subarray(0, 95))],
      ["not marked compressed", changed((b) => (b[0] &= 0x7f))],
      ["the identity", changed((b) => (b[0] |= 0x40))],
      ["a coordinate past the modulus", changed((b) => b.fill(0xff, 1))],
      ["x = 1, which no point has", changed((b) => ((b[0] &= 0xe0), b.fill(0, 1), (b[95] = 1)))],
      // On the curve, but outside the subgroup of prime order.
      ["one letter changed", `${ACCOUNTS[2].slice(0, -1)}d`],
      ["a point off the subgroup", encodeBase58(bytes(`a0${"00".repeat(46)}06${"00".repeat(47)}03`))],
    ]) {
      assert.equal(isAccount(account), false, why);
      assert.equal(accountToRawKey(account), null, why);
    }

    assert.equal(isAccount(/** @type {any} */ (undefined)), false);
    assert.equal(accountToRawKey(/** @type {any} */ (key)), null);
  });

  it("refuse a raw key that isn't one", () => {
    const raw = /** @type {Uint8Array} */ (accountToRawKey(VECTORS[1][0]));
    /** @param {(bytes: Uint8Array) => void} change */
    const changed = (change) => {
      const copy = Uint8Array.from(raw);

      change(copy);

      return copy;
    };

    for (const [why, bytes193] of /** @type {const} */ ([
      ["all 0xff", new Uint8Array(193).fill(0xff)],
      ["192 bytes", raw.subarray(0, 192)],
      ["the identity flag", changed((b) => (b[192] = 1))],
      ["a coordinate past the modulus", changed((b) => b.fill(0xff, 0, 48))],
      ["off the curve", changed((b) => (b[100] ^= 1))],
    ])) {
      assert.equal(rawKeyToAccount(bytes193), null, why);
    }

    assert.equal(rawKeyToAccount(/** @type {any} */ (Array.from(raw))), null);
  });
});
