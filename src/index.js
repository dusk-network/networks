/**
 * Dusk's networks: each one's endpoints, contracts and routes, as frozen
 * objects. Key them by the chain ID the node gives in `/on/node/info`,
 * never by hostname, so a custom node of a network gets that network.
 *
 * @module
 */

import devnet from "../networks/devnet.json" with { type: "json" };
import mainnet from "../networks/mainnet.json" with { type: "json" };
import testnet from "../networks/testnet.json" with { type: "json" };

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }

  return value;
}

/**
 * Every network there's a file for, by name. The schema and the tests hold
 * the files to the `Network` type.
 *
 * @type {Readonly<{ mainnet: import("./index.js").Network, testnet: import("./index.js").Network, devnet: import("./index.js").Network }>}
 */
export const networks = deepFreeze(
  /** @type {any} */ ({ mainnet, testnet, devnet })
);

/** @type {Map<number, import("./index.js").Network>} */
const byChainId = new Map(
  Object.values(networks).map((network) => [network.chainId, network])
);

/**
 * @param {unknown} chainId
 * @returns {number | null}
 */
function chainIdOf(chainId) {
  if (typeof chainId === "number") {
    return Number.isSafeInteger(chainId) ? chainId : null;
  }

  if (typeof chainId === "bigint") {
    return chainId <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(chainId) : null;
  }

  const match =
    typeof chainId === "string" ? /^\s*(?:dusk:)?(\d+)\s*$/.exec(chainId) : null;

  return match ? Number(match[1]) : null;
}

/**
 * The network with this chain ID (0 local, 1 mainnet, 2 testnet, 3
 * devnet), as `/on/node/info` gives it: a number, or the same as a string,
 * or "dusk:2" as some apps write it. Null for a chain there's no file for,
 * local included.
 *
 * @param {number | bigint | string} chainId
 */
export function networkFor(chainId) {
  const id = chainIdOf(chainId);

  return (id === null ? undefined : byChainId.get(id)) ?? null;
}

/**
 * @param {unknown} net
 * @returns {import("./index.js").Network}
 */
function networkOf(net) {
  const network =
    net && typeof net === "object"
      ? /** @type {import("./index.js").Network} */ (net)
      : networkFor(/** @type {number | bigint | string} */ (net));

  if (!network || typeof network.chainId !== "number" || !network.display) {
    throw new TypeError("Not one of the networks");
  }

  return network;
}

/**
 * What the explorer and Activity call a contract or an account on `net`:
 * "Transfer contract", "Sozu relayer", "DuskEVM bridge", "BSC bridge". Null
 * when it has no name here. A contract ID can come with 0x, in any case.
 *
 * @param {import("./index.js").Network | number | bigint | string} net A network, or its chain ID
 * @param {string} id A contract ID in hex, or a base58 account
 * @returns {string | null}
 */
export function labelFor(net, id) {
  const { labels } = networkOf(net).display;
  const key = typeof id === "string" ? id.trim() : "";
  const hex = key.toLowerCase().replace(/^0x/, "");
  const label = /^[0-9a-f]{64}$/.test(hex) ? labels[hex] : labels[key];

  return typeof label === "string" ? label : null;
}

/**
 * Why the apps don't send to `account` on `net`: "compromised" or "scam",
 * or null when they do.
 *
 * @param {import("./index.js").Network | number | bigint | string} net
 * @param {string} account A base58 account
 * @returns {"compromised" | "scam" | null}
 */
export function blockedReason(net, account) {
  const key = typeof account === "string" ? account.trim() : "";
  const entry = networkOf(net).display.blocklist.find((e) => e.account === key);

  return entry ? entry.reason : null;
}

/**
 * Whether the apps refuse to send to `account` on `net`: it was reported as
 * compromised, or used for scams. This only guards the apps' own forms.
 *
 * @param {import("./index.js").Network | number | bigint | string} net
 * @param {string} account A base58 account
 */
export const isBlocked = (net, account) => blockedReason(net, account) !== null;

/** @type {WeakMap<object, ReadonlyArray<import("./index.js").Route>>} */
const routeCache = new WeakMap();

/**
 * The network's routes between Dusk and the EVM chains, each with the
 * chain it reaches: migrations into Dusk, Dusk's transfers out
 * (`service`), and DuskEVM's deposits and withdrawals. A route that isn't
 * `running` is still listed, so transfers already sent on it can be
 * followed. Retired migration contracts aren't routes: see
 * `net.routes.retired`.
 *
 * @param {import("./index.js").Network | number | bigint | string} net
 * @returns {ReadonlyArray<import("./index.js").Route>}
 */
export function routes(net) {
  const network = networkOf(net);
  const known = routeCache.get(network);

  if (known) return known;

  const { chains, duskEvm, migrations, services } = network.routes;
  /** @param {string} id */
  const chainOf = (id) => {
    const chain = chains[id];

    if (!chain) throw new Error(`${network.name}: no chain ${id}`);

    return { id, ...chain };
  };
  const evm = network.duskEvm;
  const duskEvmChain = evm
    ? {
        chainId: evm.chainId,
        currency: evm.currency,
        explorerUrl: evm.explorerUrl,
        id: "dusk-evm",
        name: evm.name,
        rpcUrl: evm.rpcUrl,
      }
    : null;
  /** @type {import("./index.js").Route[]} */
  const list = [
    ...migrations.map((route) => ({
      chain: chainOf(route.chain),
      contract: route.contract,
      from: route.chain,
      id: route.id,
      kind: /** @type {const} */ ("migration"),
      payoutAccount: route.payoutAccount,
      running: route.running,
      to: "dusk",
      typicalSeconds: route.typicalSeconds,
    })),
    ...services.map((route) => ({
      account: route.account,
      chain: chainOf(route.chain),
      feeLux: BigInt(route.feeLux),
      from: "dusk",
      id: route.id,
      kind: /** @type {const} */ ("service"),
      running: route.running,
      to: route.chain,
      typicalSeconds: route.typicalSeconds,
    })),
    ...(duskEvmChain
      ? duskEvm.map((route) => ({
          chain: duskEvmChain,
          from: route.direction === "deposit" ? "dusk" : "dusk-evm",
          id: route.id,
          kind: /** @type {"duskevm-deposit" | "duskevm-withdrawal"} */ (
            route.direction === "deposit" ? "duskevm-deposit" : "duskevm-withdrawal"
          ),
          running: route.running,
          to: route.direction === "deposit" ? "dusk-evm" : "dusk",
          typicalSeconds: route.typicalSeconds,
        }))
      : []),
  ];
  const frozen = deepFreeze(list);

  routeCache.set(network, frozen);

  return frozen;
}

/**
 * The names the bridge's links take for a route besides its ID: one of its
 * three routes ("bsc" for BSC ↔ Dusk, "ethereum" for Ethereum → Dusk,
 * "duskevm" for Dusk ↔ DuskEVM), or "migrate" for whichever route into
 * Dusk runs. Each holds on a network that has such a route.
 *
 * @type {Readonly<Record<string, (route: import("./index.js").Route) => boolean>>}
 */
const ROUTE_NAMES = Object.freeze({
  bsc: (route) => route.chain.id === "bsc",
  duskevm: (route) => route.kind === "duskevm-deposit" || route.kind === "duskevm-withdrawal",
  ethereum: (route) => route.chain.id === "ethereum",
  migrate: (route) => route.kind === "migration",
});

/** Every route ID on any network, so a name none has reads as a mistake. */
const ALL_ROUTE_IDS = new Set(
  Object.values(networks).flatMap((network) => routes(network).map((r) => r.id))
);

/**
 * A link to the bridge, opened on a route: `<bridge>/#/move/<route>`, and
 * with `to`, a Dusk account the bridge pays: `?to=<account>`, as the web
 * wallet's Migrate hands its own account over. `route` is a route's ID
 * ("bsc-to-dusk") or one of the bridge's names for one ("bsc", "ethereum",
 * "duskevm", "migrate"). The bridge takes `to` on a route that pays a Dusk
 * account. Null while the network's bridge has no published address, or
 * when the network has no such route.
 *
 * @param {import("./index.js").Network | number | bigint | string} net
 * @param {{ route: string, to?: string }} options
 * @returns {string | null}
 */
export function bridgeLink(net, { route, to = "" }) {
  const network = networkOf(net);
  const name = Object.hasOwn(ROUTE_NAMES, route) ? ROUTE_NAMES[route] : null;

  if (!name && !ALL_ROUTE_IDS.has(route)) {
    throw new RangeError(`The bridge has no route called "${route}"`);
  }

  const account = typeof to === "string" ? to.trim() : "";

  if (account && !/^[1-9A-HJ-NP-Za-km-z]+$/.test(account)) {
    throw new TypeError("The recipient is a base58 Dusk account");
  }

  const bridge = network.apps.bridge;
  const has = routes(network).some((r) => (name ? name(r) : r.id === route));

  if (!bridge || !has) {
    return null;
  }

  return `${bridge}/#/move/${route}${account ? `?to=${encodeURIComponent(account)}` : ""}`;
}
