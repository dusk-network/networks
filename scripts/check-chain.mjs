#!/usr/bin/env node
/**
 * Checks the network files against the chains, read-only: one Multicall for
 * Dusk query per network asks Sozu's hub for each contract it names, and
 * calls every other Dusk contract the file names, so one that isn't there
 * shows. One request per network checks Dusk Domains' manifest against its
 * sha256. Nothing is signed or sent.
 *
 *   node scripts/check-chain.mjs [mainnet] [testnet]
 *
 * Without names it checks every network with Multicall for Dusk. It fails
 * when anything differs.
 */

import { networks } from "../src/index.js";
import { checkNetwork } from "./lib/check.mjs";

async function main(args) {
  const wanted = args.length
    ? args.map((name) => {
        const network = /** @type {Record<string, import("../src/index.js").Network>} */ (networks)[name];

        if (!network) throw new Error(`No network called ${name}`);
        if (!network.contracts.multicall) throw new Error(`${name} has no Multicall for Dusk`);

        return network;
      })
    : Object.values(networks).filter((network) => network.contracts.multicall);
  let failed = 0;

  for (const network of wanted) {
    const problems = await checkNetwork(network).catch((error) => [String(error?.message ?? error)]);

    for (const problem of problems) console.log(`  DIFFERS: ${problem}`);
    if (problems.length) failed += 1;
  }

  if (failed) process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
