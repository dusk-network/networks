#!/usr/bin/env node
/**
 * Regenerates the DuskEVM part of each network file from a checkout of
 * dusk-network/duskevm-genesis: the L2 chain ID and native coin, every L1
 * contract on Dusk with its name, the files they came from, and the labels
 * of those contracts. The rest of `duskEvm` (name, endpoints, predeploys,
 * drivers) is kept as written. Only networks whose `duskEvm` isn't null are
 * generated.
 *
 *   node scripts/gen-duskevm.mjs <duskevm-genesis checkout> [--check]
 *
 * With --check it writes nothing and fails when a file would change.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { formatEvmAddress } from "../src/format.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NETWORKS = ["mainnet", "testnet", "devnet"];
const REPOSITORY = "https://github.com/dusk-network/duskevm-genesis";

/**
 * How the explorer and Activity name an L1 contract, by its genesis key,
 * where "DuskEVM" and the key's words don't say it.
 */
const LABELS = Object.freeze({
  delayed_weth: "DuskEVM delayed WETH",
  evm_tx_router: "DuskEVM transaction router",
  fault_dispute_game_hub: "DuskEVM fault dispute games",
  l1_cross_domain_messenger: "DuskEVM messenger",
  l1_erc721_bridge: "DuskEVM ERC-721 bridge",
  l1_standard_bridge: "DuskEVM bridge",
  mips: "DuskEVM MIPS",
  optimism_mintable_erc20_factory: "DuskEVM ERC-20 factory",
  optimism_mintable_erc721_factory: "DuskEVM ERC-721 factory",
  optimism_portal: "DuskEVM bridge portal",
  permissioned_dispute_game_hub: "DuskEVM permissioned dispute games",
  system_config_impl: "DuskEVM system config (implementation)",
  system_config_legacy: "DuskEVM system config (legacy)",
  tx_meta_registry: "DuskEVM transaction metadata",
});

/** A key the table doesn't have: its words, after "DuskEVM". */
export const labelOf = (key) => LABELS[key] ?? `DuskEVM ${key.replaceAll("_", " ")}`;

/** An EVM-native coin has 18 decimals. */
const NATIVE_DECIMALS = 18;

const fail = (message) => {
  throw new Error(message);
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** rollup.json's own record of a contract, and the address book's key for it. */
const REQUIRED_PAIRS = [
  ["deposit_contract_address", "optimism_portal"],
  ["l1_system_config_address", "system_config"],
];

/**
 * The generated part of one network, from its genesis directory.
 *
 * @param {string} genesisDir
 * @param {string} name
 * @param {any} network
 */
export function generate(genesisDir, name, network) {
  const dir = join(genesisDir, name);
  const addressesPath = join(dir, "l1-addresses.json");
  const rollupPath = join(dir, "rollup.json");

  if (!existsSync(addressesPath) || !existsSync(rollupPath)) {
    fail(`${name}: ${dir} has no l1-addresses.json and rollup.json`);
  }

  const addressesBytes = readFileSync(addressesPath);
  const rollupBytes = readFileSync(rollupPath);
  const addresses = JSON.parse(addressesBytes.toString("utf8"));
  const rollup = JSON.parse(rollupBytes.toString("utf8"));

  if (rollup.l1_chain_id !== network.chainId) {
    fail(`${name}: rollup.json's L1 is chain ${rollup.l1_chain_id}, not Dusk chain ${network.chainId}`);
  }

  if (!Number.isSafeInteger(rollup.l2_chain_id) || rollup.l2_chain_id <= 0) {
    fail(`${name}: rollup.json has no L2 chain ID`);
  }

  if (
    !addresses.contracts ||
    typeof addresses.contracts !== "object" ||
    Object.keys(addresses.contracts).length === 0
  ) {
    fail(`${name}: l1-addresses.json lists no contracts`);
  }

  const contracts = {};

  for (const key of Object.keys(addresses.contracts).sort()) {
    const { contract_id: id, evm_address: evm } = addresses.contracts[key];

    if (!/^[0-9a-f]{64}$/.test(id ?? "")) fail(`${name}: ${key} has no contract ID`);
    if (!EVM_ADDRESS.test(evm ?? "")) fail(`${name}: ${key} has no EVM address`);

    contracts[key] = { contractId: id, evmAddress: formatEvmAddress(evm) };
  }

  // The rollup's record of the portal and the system config must be the
  // contracts the address book names, both there: else the two files
  // aren't one set.
  for (const [field, key] of REQUIRED_PAIRS) {
    const fromRollup = rollup[field];
    const fromBook = contracts[key]?.evmAddress;

    if (typeof fromRollup !== "string" || !EVM_ADDRESS.test(fromRollup)) {
      fail(`${name}: rollup.json has no ${field}`);
    }

    if (!fromBook) fail(`${name}: l1-addresses.json has no ${key}`);

    if (fromRollup.toLowerCase() !== fromBook.toLowerCase()) {
      fail(`${name}: rollup.json's ${field} isn't l1-addresses.json's ${key}`);
    }
  }

  // The L2 genesis, where the checkout has it: the same chain, and the
  // predeploys the file names have code there.
  const genesisPath = join(dir, "genesis.json");
  let currency = { decimals: NATIVE_DECIMALS, name: "DUSK", symbol: "DUSK" };

  if (existsSync(genesisPath)) {
    const genesis = JSON.parse(readFileSync(genesisPath, "utf8"));
    const alloc = Object.fromEntries(
      Object.entries(genesis.alloc ?? {}).map(([address, account]) => [
        address.toLowerCase().replace(/^0x/, ""),
        account,
      ])
    );

    if (genesis.config?.chainId !== rollup.l2_chain_id) {
      fail(`${name}: genesis.json is chain ${genesis.config?.chainId}, rollup.json ${rollup.l2_chain_id}`);
    }

    for (const [predeploy, address] of Object.entries(network.duskEvm.predeploys ?? {})) {
      const code = alloc[address.toLowerCase().replace(/^0x/, "")]?.code;

      if (!code || code === "0x") fail(`${name}: predeploy ${predeploy} has no code in genesis.json`);
    }

    const coin = genesis.duskevm?.nativeTokenMetadata;

    if (coin?.name && coin?.symbol) {
      currency = { decimals: NATIVE_DECIMALS, name: coin.name, symbol: coin.symbol };
    }
  }

  // One label per contract ID. Two keys can share one (a proxy and the
  // contract it fronts): the key the address book calls the proxy names it.
  const proxies = new Map(
    (addresses.metadata?.proxy_forwarded_event_schemas ?? []).map((schema) => [
      schema.proxy_contract_id,
      schema.proxy_contract_key,
    ])
  );
  const labels = {};

  for (const [key, { contractId }] of Object.entries(contracts)) {
    const owner = proxies.get(contractId);

    if (!(contractId in labels) || owner === key) {
      labels[contractId] = labelOf(owner && contracts[owner] ? owner : key);
    }
  }

  return {
    chainId: rollup.l2_chain_id,
    contracts,
    currency,
    labels,
    source: {
      files: {
        [`${name}/l1-addresses.json`]: sha256(addressesBytes),
        [`${name}/rollup.json`]: sha256(rollupBytes),
      },
      repository: REPOSITORY,
    },
  };
}

/**
 * The network with its DuskEVM part regenerated, its keys where the file
 * has them.
 *
 * @param {any} network
 * @param {ReturnType<typeof generate>} generated
 */
export function merge(network, generated) {
  const { labels: generatedLabels, ...part } = generated;
  const before = network.duskEvm;
  const old = new Set(Object.values(before.contracts ?? {}).map((c) => c.contractId));
  const labels = Object.fromEntries(
    Object.entries(network.display.labels).filter(([id]) => !old.has(id))
  );

  for (const [id, label] of Object.entries(generatedLabels)) {
    if (id in labels && labels[id] !== label) {
      // Another part of the file names it: keep that name.
      continue;
    }

    labels[id] = label;
  }

  return {
    ...network,
    display: { ...network.display, labels },
    duskEvm: { ...before, ...part },
  };
}

/**
 * @param {string[]} args
 * @param {string} [root] The repo, whose networks/*.json are read and written
 */
export function main(args, root = ROOT) {
  const check = args.includes("--check");
  const genesisDir = args.find((arg) => !arg.startsWith("--"));

  if (!genesisDir || !existsSync(genesisDir)) {
    fail("Usage: node scripts/gen-duskevm.mjs <duskevm-genesis checkout> [--check]");
  }

  let changed = 0;

  for (const name of NETWORKS) {
    const path = join(root, "networks", `${name}.json`);
    const text = readFileSync(path, "utf8");
    const network = JSON.parse(text);

    if (network.duskEvm === null) {
      console.log(`${name}: no DuskEVM, skipped`);
      continue;
    }

    const next = `${JSON.stringify(merge(network, generate(genesisDir, name, network)), null, 2)}\n`;

    if (next === text) {
      console.log(`${name}: up to date`);
      continue;
    }

    changed += 1;

    if (check) {
      console.log(`${name}: differs from ${join(genesisDir, name)}; run gen-duskevm.mjs`);
    } else {
      writeFileSync(path, next);
      console.log(`${name}: written`);
    }
  }

  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const changed = main(process.argv.slice(2));

    if (changed && process.argv.includes("--check")) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
