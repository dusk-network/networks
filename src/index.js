/* @ts-self-types="./index.d.ts" */
/**
 * Dusk's networks, as frozen objects, and what the apps look up in them.
 *
 * @module
 */

import { deepFreeze, networkFor, networkOf, networks } from "./networks.js";

/** @typedef {import("./index.js").Network} Network */
/** @typedef {import("./index.js").NetworkRef} NetworkRef */
/** @typedef {import("./index.js").Route} Route */

export { networkFor, networks };

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
      payoutAddress: route.payoutAddress ?? null,
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
 * The bridge's account on both sides of a transfer: DUSK sent to a service
 * route's account leaves Dusk on that route; DUSK received from a
 * migration's payout account is that migration paid out. One account can
 * be both, as BSC's is on mainnet, so the direction picks.
 *
 * @param {NetworkRef} net
 * @param {string} account
 * @param {"in" | "out"} direction
 * @returns {Route | null}
 */
export function routeForAccount(net, account, direction) {
  if (direction !== "in" && direction !== "out") {
    throw new RangeError('The direction is "in" or "out"');
  }

  const list = routes(net);
  const key = typeof account === "string" ? account.trim() : "";

  if (!key) {
    return null;
  }

  return (
    list.find((route) =>
      direction === "out"
        ? route.kind === "service" && route.account === key
        : route.kind === "migration" && route.payoutAccount === key
    ) ?? null
  );
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
