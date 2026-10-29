/**
 * The checks check-chain.mjs makes of one network, with the fetch and the
 * log given, so tests can run them without a node.
 */

import { createHash } from "node:crypto";

import { HUB_NAME_ARGS, decodeContractId } from "../../src/sozu.js";
import { decodeAggregate, encodeAggregate, fromHex } from "./multicall.mjs";

/** The hub's name for each fallback in the file. */
const HUB_NAMES = Object.freeze({
  pool: "pool",
  relayer: "relayer",
  stDusk: "staked-dusk",
  substrate: "substrate",
  vault: "vault",
});

/** A function no contract has: an existing contract answers "Unknown". */
const PROBE = "check_chain_probe";

/**
 * Every Dusk contract the file names, but the hub and Multicall itself,
 * each with where the file names it.
 *
 * @param {import("../../src/index.js").Network} network
 */
function contractsOf(network) {
  /** @type {Map<string, string>} */
  const found = new Map();
  const add = (/** @type {string | null} */ id, /** @type {string} */ where) => {
    if (id && !found.has(id)) found.set(id, where);
  };

  add(network.contracts.transfer, "contracts.transfer");
  add(network.contracts.stake, "contracts.stake");

  for (const [key, id] of Object.entries(network.sozu?.fallbacks ?? {})) {
    add(id, `sozu.fallbacks.${key}`);
  }

  for (const [key, { contractId }] of Object.entries(network.duskEvm?.contracts ?? {})) {
    add(contractId, `duskEvm.contracts.${key}`);
  }

  return found;
}

/**
 * @param {import("../../src/index.js").Network} network
 * @param {{ fetch?: typeof fetch, log?: (line: string) => void }} [options]
 * @returns {Promise<string[]>} What differs
 */
export async function checkNetwork(network, { fetch = globalThis.fetch, log = console.log } = {}) {
  const problems = [];
  const multicall = network.contracts.multicall;
  const names = network.sozu ? Object.entries(HUB_NAMES) : [];
  const probes = [...contractsOf(network)];
  const calls = [
    ...names.map(([, name]) => ({
      args: fromHex(HUB_NAME_ARGS[/** @type {keyof typeof HUB_NAME_ARGS} */ (name)]),
      contractId: /** @type {NonNullable<typeof network.sozu>} */ (network.sozu).hub,
      fnName: "contract",
    })),
    ...probes.map(([contractId]) => ({ args: new Uint8Array(0), contractId, fnName: PROBE })),
  ];
  const res = await fetch(`${network.urls.node}/on/contracts:${multicall}/aggregate`, {
    body: encodeAggregate(calls),
    headers: { "Content-Type": "application/octet-stream" },
    method: "POST",
  });

  if (!res.ok) {
    return [`Multicall for Dusk didn't answer: HTTP ${res.status}`];
  }

  const { height, results } = decodeAggregate(new Uint8Array(await res.arrayBuffer()), calls.length);

  log(`${network.name}: one query of ${calls.length} reads, at block ${height}`);

  names.forEach(([key, name], i) => {
    const result = results[i];
    const want = /** @type {Record<string, string>} */ (network.sozu?.fallbacks)[key];

    if (!result.ok) {
      problems.push(`hub.contract("${name}") failed: ${result.error}`);
      return;
    }

    const named = decodeContractId(result.ok);

    if (named !== want) {
      problems.push(`the hub names ${named ?? "nothing"} as "${name}", the file ${want}`);
    } else {
      log(`  hub "${name}" = sozu.fallbacks.${key}`);
    }
  });

  let present = 0;

  probes.forEach(([id, where], i) => {
    const result = results[names.length + i];

    if (result.error === "DoesNotExist") {
      problems.push(`${where} ${id} isn't on chain`);
    } else if (result.error === "Unknown" || result.ok) {
      present += 1;
    } else {
      problems.push(`${where} ${id} answered ${result.error}`);
    }
  });

  log(`  ${present} of ${probes.length} other contracts are on chain`);

  for (const problem of await checkPayouts(network, { fetch, log })) problems.push(problem);

  if (network.duskDomains) {
    const { sha256, url } = network.duskDomains.manifest;
    const manifest = await fetch(url);
    const digest = manifest.ok
      ? createHash("sha256").update(new Uint8Array(await manifest.arrayBuffer())).digest("hex")
      : `HTTP ${manifest.status}`;

    if (digest === sha256) {
      log(`  Dusk Domains manifest matches its sha256`);
    } else {
      problems.push(`Dusk Domains manifest ${url} is ${digest}, the file ${sha256}`);
    }
  }

  return problems;
}


/**
 * Each service route's payout address, on its chain: one JSON-RPC batch
 * per route asks for its code and its nonce. The address that pays a route
 * out is an account, which has sent transactions there; one that has sent
 * none, or a contract, isn't it.
 *
 * @param {import("../../src/index.js").Network} network
 * @param {{ fetch: typeof fetch, log: (line: string) => void }} io
 * @returns {Promise<string[]>} What differs
 */
async function checkPayouts(network, { fetch, log }) {
  const problems = [];

  for (const route of network.routes.services) {
    const address = route.payoutAddress;
    const chain = network.routes.chains[route.chain];

    if (!address) continue;

    const res = await fetch(chain.rpcUrl, {
      body: JSON.stringify([
        { id: 1, jsonrpc: "2.0", method: "eth_getCode", params: [address, "latest"] },
        { id: 2, jsonrpc: "2.0", method: "eth_getTransactionCount", params: [address, "latest"] },
      ]),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const replies = res.ok ? await res.json().catch(() => null) : null;
    /** @param {number} id */
    const result = (id) => (Array.isArray(replies) ? replies.find((reply) => reply?.id === id)?.result : undefined);
    const code = result(1);
    const nonce = /^0x[0-9a-f]+$/i.test(String(result(2))) ? BigInt(result(2)) : null;

    if (typeof code !== "string" || nonce === null) {
      problems.push(`${chain.name} didn't say what ${route.id}'s payout address ${address} is: HTTP ${res.status}`);
    } else if (code !== "0x") {
      problems.push(`${route.id}'s payout address ${address} is a contract on ${chain.name}`);
    } else if (nonce === 0n) {
      problems.push(`${route.id}'s payout address ${address} has sent nothing on ${chain.name}`);
    } else {
      log(`  ${route.id} pays out from ${address}, which has sent ${nonce} transactions on ${chain.name}`);
    }
  }

  return problems;
}
