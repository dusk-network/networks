/**
 * Dusk's networks, as frozen objects, and what the apps look up in them.
 *
 * @module
 */

import devnet from "../networks/devnet.json" with { type: "json" };
import mainnet from "../networks/mainnet.json" with { type: "json" };
import testnet from "../networks/testnet.json" with { type: "json" };

/** @typedef {import("./index.js").Network} Network */
/** @typedef {import("./index.js").NetworkRef} NetworkRef */
/** @typedef {import("./index.js").Route} Route */

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
 * The schema and the tests hold the files to the `Network` type.
 *
 * @type {Readonly<{ mainnet: Network, testnet: Network, devnet: Network }>}
 */
export const networks = deepFreeze(
  /** @type {any} */ ({ mainnet, testnet, devnet })
);

/**
 * @param {number | bigint | string} chainId
 * @returns {Network | null}
 */
export function networkFor(chainId) {
  const digits =
    typeof chainId === "string" ? /^\s*(?:dusk:)?(\d+)\s*$/.exec(chainId)?.[1] : undefined;
  const id =
    typeof chainId === "bigint" ? Number(chainId) : digits === undefined ? chainId : Number(digits);

  return Object.values(networks).find((network) => network.chainId === id) ?? null;
}

/**
 * @param {unknown} net
 * @returns {Network}
 */
function networkOf(net) {
  const network =
    net && typeof net === "object"
      ? /** @type {Network} */ (net)
      : networkFor(/** @type {number | bigint | string} */ (net));

  if (!network || typeof network.chainId !== "number" || !network.display) {
    throw new TypeError("Not one of the networks");
  }

  return network;
}

/**
 * @param {NetworkRef} net
 * @param {string} id A contract ID in hex, with or without 0x, or a base58 account
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
 * @param {NetworkRef} net
 * @param {string} account
 * @returns {"compromised" | "scam" | null}
 */
export function blockedReason(net, account) {
  const key = typeof account === "string" ? account.trim() : "";
  const entry = networkOf(net).display.blocklist.find((e) => e.account === key);

  return entry ? entry.reason : null;
}

/**
 * This only guards the apps' own forms.
 *
 * @param {NetworkRef} net
 * @param {string} account
 */
export const isBlocked = (net, account) => blockedReason(net, account) !== null;

/** @type {WeakMap<object, ReadonlyArray<Route>>} */
const routeCache = new WeakMap();

/**
 * A route that isn't `running` stays listed, so transfers already sent on
 * it can be followed.
 *
 * @param {NetworkRef} net
 * @returns {ReadonlyArray<Route>}
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
  /** @type {Route[]} */
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
 * The bridge's names for a route besides its ID (its names.js): one of its
 * three routes, or "migrate" for whichever route into Dusk runs.
 *
 * @type {Readonly<Record<string, (route: Route) => boolean>>}
 */
const ROUTE_NAMES = Object.freeze({
  bsc: (route) => route.chain.id === "bsc",
  duskevm: (route) => route.kind === "duskevm-deposit" || route.kind === "duskevm-withdrawal",
  ethereum: (route) => route.chain.id === "ethereum",
  migrate: (route) => route.kind === "migration",
});

/** A Dusk account, base58, as the schema writes one. */
const ACCOUNT = /^[1-9A-HJ-NP-Za-km-z]{100,140}$/;

/** Every route ID on any network, so a name none has reads as a mistake. */
const ALL_ROUTE_IDS = new Set(
  Object.values(networks).flatMap((network) => routes(network).map((r) => r.id))
);

/**
 * The bridge's hand-off: `#/move/<route>?to=<account>`.
 *
 * @param {NetworkRef} net
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

  if (account && !ACCOUNT.test(account)) {
    throw new TypeError("The recipient isn't a Dusk account");
  }

  const bridge = network.apps.bridge;
  const has = routes(network).some((r) => (name ? name(r) : r.id === route));

  if (!bridge || !has) {
    return null;
  }

  return `${bridge}/#/move/${route}${account ? `?to=${encodeURIComponent(account)}` : ""}`;
}
