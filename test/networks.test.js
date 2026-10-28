import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { formatEvmAddress } from "../src/format.js";
import {
  blockedReason,
  bridgeLink,
  isBlocked,
  labelFor,
  networkFor,
  networks,
  routes,
} from "../src/index.js";
import { validate } from "../scripts/lib/schema.mjs";

const read = (/** @type {string} */ path) =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const schema = read("schema.json");
const files = readdirSync(new URL("../networks/", import.meta.url)).filter((f) => f.endsWith(".json"));

/**
 * Every value in a file under its path, for checks across the whole file.
 *
 * @param {unknown} value
 * @param {string} [path]
 * @returns {[string, unknown][]}
 */
function leaves(value, path = "$") {
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => leaves(item, `${path}.${key}`));
  }

  return [[path, value]];
}

const CONTRACT_ID = /^[0-9a-f]{64}$/;
const ACCOUNT = /^[1-9A-HJ-NP-Za-km-z]{100,140}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

describe("the network files", () => {
  it("are mainnet, testnet and devnet, and each passes the schema", () => {
    assert.deepEqual(files.sort(), ["devnet.json", "mainnet.json", "testnet.json"]);

    for (const file of files) {
      assert.deepEqual(validate(schema, read(`networks/${file}`)), [], file);
    }
  });

  it("name themselves after their file, with the node's chain IDs", () => {
    for (const file of files) {
      assert.equal(read(`networks/${file}`).name, file.replace(/\.json$/, ""));
    }

    assert.deepEqual(
      Object.values(networks).map(({ chainId, name }) => [name, chainId]),
      [["mainnet", 1], ["testnet", 2], ["devnet", 3]]
    );
  });

  it("write every EVM address with its EIP-55 checksum", () => {
    for (const network of Object.values(networks)) {
      for (const [path, value] of leaves(network)) {
        if (typeof value === "string" && EVM_ADDRESS.test(value)) {
          assert.equal(value, formatEvmAddress(value), `${network.name} ${path}`);
        }
      }
    }
  });

  it("name every contract and account they hold, and nothing else", () => {
    for (const network of Object.values(networks)) {
      const ids = new Set(
        leaves(network)
          .filter(([path]) => !path.startsWith("$.display"))
          .map(([, value]) => value)
          .filter((value) => typeof value === "string" && (CONTRACT_ID.test(value) || ACCOUNT.test(value)))
      );
      // Hashes and the release's commit aren't contracts.
      const hashes = new Set(
        leaves(network)
          .filter(([path]) => /sha256|\.source\.|\.manifest\./.test(path))
          .map(([, value]) => value)
      );
      const named = Object.keys(network.display.labels);

      for (const id of ids) {
        if (!hashes.has(id)) assert.ok(labelFor(network, id), `${network.name}: no label for ${id}`);
      }

      for (const id of named) {
        assert.ok(ids.has(id), `${network.name}: a label for ${id}, which the file doesn't hold`);
      }
    }
  });

  it("keep the IDs the apps share, and the ones the research found on each hub", () => {
    const { mainnet, testnet, devnet } = networks;

    for (const network of [mainnet, testnet, devnet]) {
      assert.equal(network.contracts.transfer, `01${"0".repeat(62)}`);
      assert.equal(network.contracts.stake, `02${"0".repeat(62)}`);
    }

    assert.equal(mainnet.contracts.multicall, "93de287b7d349d678a0038fe7772e8960e1a84a1b5da2d0b1f62f532616ce1d4");
    assert.equal(testnet.contracts.multicall, mainnet.contracts.multicall);
    assert.equal(devnet.contracts.multicall, null);
    assert.equal(mainnet.sozu?.hub, "b32c917e76abc6fcf2edbee0fa70231d8e19c405b18421794a11badfc66d2f26");
    assert.equal(testnet.sozu?.fallbacks.relayer, "51ced4fad52fc590def2736969c9e3e30013275a996c53714b81d8a08774aa37");

    for (const network of [mainnet, testnet]) {
      const all = [network.sozu?.hub, ...Object.values(network.sozu?.fallbacks ?? {})];

      assert.equal(new Set(all).size, 6, network.name);
    }
  });

  it("have DuskEVM on testnet only, from duskevm-genesis", () => {
    const { mainnet, testnet, devnet } = networks;
    const evm = testnet.duskEvm;

    assert.equal(mainnet.duskEvm, null);
    assert.equal(devnet.duskEvm, null);
    assert.ok(evm);
    assert.equal(evm.chainId, 745);
    assert.equal(Object.keys(evm.contracts).length, 22);
    assert.equal(new Set(Object.values(evm.contracts).map((c) => c.contractId)).size, 21);
    assert.equal(evm.contracts.l1_standard_bridge.contractId, "2257e5f8ff49cf7c9704a14ca35acbf48eb7ade11a079d98d5cd5655eea1b31d");
    assert.equal(evm.contracts.optimism_portal.contractId, "14eeb3d4021aff09af2c515603a01f8d956a7f6411d11a1b1c0b0561a93fb1b9");
    assert.equal(evm.contracts.dispute_game_factory.contractId, "3b7d562aa0e6b94ce29c5ce2a6f0587ad771afdace86abb0baf66f93e49548cd");
    assert.equal(evm.contracts.anchor_state_registry.contractId, "1735498c11978854e390894502850916f4ba619e3f4b88c10ef758c5026619cc");
    assert.equal(labelFor(testnet, evm.contracts.evm_tx_router.contractId), "DuskEVM transaction router");
    assert.equal(labelFor(testnet, evm.contracts.tx_meta_registry.contractId), "DuskEVM transaction metadata");
    assert.equal(labelFor(testnet, evm.contracts.transparent_proxy.contractId), "DuskEVM system config");
    assert.equal(evm.drivers.optimismPortal.sha256, "9220bf0e96f8d1d20ae8c56459c75d402045bb0fa63851b9413c7db57749b360");
    assert.equal(evm.drivers.disputeGameFactory.sha256, "dd07f5a584779940bf116fb2ea32f455f8afbe3399c8e1f125f99f98d499afca");
    assert.equal(evm.predeploys.l2StandardBridge, "0x4200000000000000000000000000000000000010");
  });

  it("point at Dusk Domains' manifest without copying its contracts", () => {
    const { mainnet, testnet, devnet } = networks;

    assert.deepEqual(mainnet.duskDomains?.manifest, {
      sha256: "092fbda51bfb48aba504a3f89313446efa1b072de9063322b20d0d866dc945de",
      url: "https://dusk.domains/manifest.json",
      version: "5d5eca506323d18979157cb88858e81ea0157b7e",
    });
    assert.equal(testnet.duskDomains?.manifest.url, "https://testnet.dusk.domains/manifest.json");
    assert.equal(devnet.duskDomains, null);
    // The manifest's directory on mainnet isn't named here.
    assert.equal(labelFor(mainnet, "e6cea1e703a0bda45f96575db3009e69be5446d43a593ab8a381520b8dc6ba18"), null);
  });

  it("have each route's chain, and route IDs as the bridge writes them", () => {
    for (const network of Object.values(networks)) {
      const { chains, migrations, services, duskEvm, retired } = network.routes;

      for (const route of migrations) {
        assert.ok(chains[route.chain], `${network.name} ${route.id}`);
        assert.equal(route.id, `${route.chain}-to-dusk`);
      }

      for (const route of services) {
        assert.ok(chains[route.chain], `${network.name} ${route.id}`);
        assert.equal(route.id, `dusk-to-${route.chain}`);
      }

      for (const old of retired) {
        assert.ok(chains[old.chain]);
        assert.ok(!migrations.some((route) => route.contract === old.contract));
      }

      assert.equal(duskEvm.length > 0, network.duskEvm !== null);
    }
  });

  it("run BSC both ways and Ethereum one way on mainnet, and nothing to Sepolia", () => {
    const ids = (/** @type {number} */ chain) =>
      routes(chain).map((route) => `${route.id}${route.running ? "" : " (not running)"}`);

    assert.deepEqual(ids(1), ["bsc-to-dusk", "ethereum-to-dusk", "dusk-to-bsc"]);
    assert.deepEqual(ids(2), [
      "ethereum-to-dusk (not running)",
      "dusk-to-ethereum (not running)",
      "dusk-to-dusk-evm",
      "dusk-evm-to-dusk",
    ]);
    assert.deepEqual(ids(3), []);
    assert.equal(networks.testnet.routes.migrations[0].contract, "0x7B1FF96D7edC07D8d83eC2A4da99EF8215a7366B");
    assert.deepEqual(
      networks.testnet.routes.retired.map((old) => old.contract),
      ["0x81F15Ed1D87A6C840E410D7740D581e36c661640", "0x1Bb81fbd735854Ed901aD7Aa1f5F72F64E5841Fc"]
    );
  });

  it("name Dusk as the operator, with its terms and privacy notice", () => {
    for (const network of Object.values(networks)) {
      assert.deepEqual(network.operator, {
        name: "Dusk",
        privacyUrl: "https://dusk.network/privacy-policy",
        termsUrl: "https://dusk.network/terms-of-use",
      });
    }
  });

  it("know where the wallet and the explorer are, and not yet the bridge", () => {
    assert.deepEqual(networks.mainnet.apps, {
      bridge: null,
      explorer: "https://apps.dusk.network/explorer",
      wallet: "https://apps.dusk.network/wallet",
    });
    assert.equal(networks.testnet.apps.wallet, "https://apps.testnet.dusk.network/wallet");
    assert.equal(networks.devnet.apps.explorer, "https://apps.devnet.dusk.network/explorer");
  });

  it("are frozen all the way down", () => {
    assert.ok(Object.isFrozen(networks));
    assert.ok(Object.isFrozen(networks.testnet.duskEvm?.contracts.mips));
    assert.throws(() => {
      /** @type {any} */ (networks.mainnet.display.labels)["ab".repeat(32)] = "x";
    }, TypeError);
  });
});

describe("networkFor", () => {
  it("takes the chain ID as /on/node/info gives it, or as some apps write it", () => {
    assert.equal(networkFor(1), networks.mainnet);
    assert.equal(networkFor("2"), networks.testnet);
    assert.equal(networkFor(3n), networks.devnet);
    assert.equal(networkFor("dusk:1"), networks.mainnet);
  });

  it("has no network for a chain without a file", () => {
    for (const id of [0, 41, -1, 1.5, "x", "", "dusk:", 2n ** 70n]) {
      assert.equal(networkFor(/** @type {any} */ (id)), null, String(id));
    }
  });
});

describe("labelFor", () => {
  it("names contracts in any case, with or without 0x, and accounts", () => {
    const { mainnet, testnet } = networks;

    assert.equal(labelFor(mainnet, `0x01${"0".repeat(62)}`), "Transfer contract");
    assert.equal(labelFor(testnet, "51CED4FAD52FC590DEF2736969C9E3E30013275A996C53714B81D8A08774AA37"), "Sozu relayer");
    assert.equal(labelFor(testnet, "0077ecbf88aa20d6d0a6afa20bd26300a2b562fdbac368bf1e3c1325e8555941"), "Sozu substrate");
    assert.equal(labelFor(1, "2427XSRsdBpgBp3TtcYbFXc8NoGXX4pRZNurE1uRcSgsyGTo4yFJz3or2id85xZdGimEREB8ufEuW9UTPoX53r9ns4EsfSuLkzNMyqt4ha34A6T3DbjBKYNowih6YLGW1Zvi"), "Ethereum migration payouts");
    assert.equal(labelFor(2, "2257e5f8ff49cf7c9704a14ca35acbf48eb7ade11a079d98d5cd5655eea1b31d"), "DuskEVM bridge");
  });

  it("has no name for what the network doesn't know", () => {
    assert.equal(labelFor(networks.mainnet, "2257e5f8ff49cf7c9704a14ca35acbf48eb7ade11a079d98d5cd5655eea1b31d"), null);
    assert.equal(labelFor(networks.mainnet, "toString"), null);
    assert.equal(labelFor(networks.mainnet, /** @type {any} */ (undefined)), null);
    assert.throws(() => labelFor(41, "x"), TypeError);
  });
});

describe("the blocklist", () => {
  const COMPROMISED =
    "mFqH6RVxCoWQfjQ23H9YVr8JhQ697M5DD4ob76kcuoEYqqYA6H9cxHrxjvnZ6z4PQKsBd3PBpRYLN9M3FgkQQVywREzkzgeme4ersJgLaxYaQzZSAzkd1QBJ4ByTe9NrhXp";
  const SCAM =
    "25kt7vYP5JNJ1vborhco4dJBFfdHsFrS8oBsPZ6Q2wWmE6FYwahaE1heg8HSgc8C6KwHxpm19WxrgCuCtBDBfTJD6WNLi8jMqC2nkz6dEE3oepoMLsEYQnopTi5oPzfr7wGk";

  it("refuses the web wallet's two accounts on every network, and says why", () => {
    for (const network of Object.values(networks)) {
      assert.equal(isBlocked(network, COMPROMISED), true);
      assert.equal(isBlocked(network, ` ${SCAM}\n`), true);
      assert.equal(blockedReason(network, COMPROMISED), "compromised");
      assert.equal(blockedReason(network, SCAM), "scam");
    }
  });

  it("lets every other account through", () => {
    assert.equal(isBlocked(1, "24jFms4JqYdWb19jFn3CUjNUQz1AeRozYnwsHuUkLbXAj2gRBq598aLAJmqmsaPcsCNJTgTaJTaUZCXpT3s9UeWBsHTmd5hQx95JymZSUsmtwoibiB8AMp4bZjAiLMjmAH3x"), false);
    assert.equal(isBlocked(1, COMPROMISED.slice(1)), false);
    assert.equal(isBlocked(1, /** @type {any} */ (null)), false);
  });
});

describe("routes", () => {
  it("gives each route the chain it reaches, and its fee in lux", () => {
    const [bscIn, , bscOut] = routes(1);

    assert.equal(bscIn.kind, "migration");
    assert.equal(bscIn.chain.chainId, 56);
    assert.equal(bscIn.chain.token, "0xB2BD0749DBE21f623d9BABa856D3B0f0e1BFEc9C");
    assert.equal(bscIn.chain.tokenLabel, "BEP20 DUSK");
    assert.ok(bscOut.kind === "service");
    assert.equal(bscOut.feeLux, 1_000_000_000n);
    assert.equal(bscOut.typicalSeconds, 36_000);
    assert.equal(bscOut.from, "dusk");
    assert.equal(bscOut.to, "bsc");
  });

  it("reaches DuskEVM on testnet, both ways", () => {
    const [deposit, withdrawal] = routes(2).slice(2);

    assert.deepEqual(
      [deposit.kind, deposit.from, deposit.to, deposit.typicalSeconds],
      ["duskevm-deposit", "dusk", "dusk-evm", 60]
    );
    assert.deepEqual([withdrawal.kind, withdrawal.from, withdrawal.to], ["duskevm-withdrawal", "dusk-evm", "dusk"]);
    assert.equal(withdrawal.chain.chainId, 745);
  });

  it("gives the same frozen list each time", () => {
    assert.equal(routes(1), routes(networks.mainnet));
    assert.ok(Object.isFrozen(routes(1)[0].chain));
  });
});

describe("bridgeLink", () => {
  // Any Dusk account: the Ethereum payouts' account.
  const ACCOUNT =
    "2427XSRsdBpgBp3TtcYbFXc8NoGXX4pRZNurE1uRcSgsyGTo4yFJz3or2id85xZdGimEREB8ufEuW9UTPoX53r9ns4EsfSuLkzNMyqt4ha34A6T3DbjBKYNowih6YLGW1Zvi";
  /** A network whose bridge has an address. */
  const published = (/** @type {import("../src/index.js").Network} */ network) => ({
    ...network,
    apps: { ...network.apps, bridge: "https://bridge.example" },
  });

  it("is null while the bridge has no published address", () => {
    assert.equal(bridgeLink(networks.mainnet, { route: "bsc", to: ACCOUNT }), null);
  });

  it("opens the bridge on a route, and hands over a Dusk recipient", () => {
    const mainnet = published(networks.mainnet);

    assert.equal(bridgeLink(mainnet, { route: "bsc-to-dusk" }), "https://bridge.example/#/move/bsc-to-dusk");
    assert.equal(
      bridgeLink(mainnet, { route: "migrate", to: ACCOUNT }),
      `https://bridge.example/#/move/migrate?to=${ACCOUNT}`
    );
    assert.equal(bridgeLink(mainnet, { route: "ethereum", to: ` ${ACCOUNT} ` }), `https://bridge.example/#/move/ethereum?to=${ACCOUNT}`);
    assert.equal(bridgeLink(published(networks.testnet), { route: "duskevm" }), "https://bridge.example/#/move/duskevm");
  });

  it("has no link to a route the network doesn't have", () => {
    assert.equal(bridgeLink(published(networks.testnet), { route: "bsc" }), null);
    assert.equal(bridgeLink(published(networks.mainnet), { route: "dusk-to-dusk-evm" }), null);
    assert.equal(bridgeLink(published(networks.devnet), { route: "migrate" }), null);
  });

  it("refuses a route the bridge has no name for, and a recipient that isn't base58", () => {
    assert.throws(() => bridgeLink(published(networks.mainnet), { route: "bcs" }), RangeError);
    assert.throws(() => bridgeLink(published(networks.mainnet), { route: "toString" }), RangeError);
    assert.throws(() => bridgeLink(published(networks.mainnet), { route: "bsc", to: "0x12/34" }), TypeError);
  });
});
