/**
 * The network files as frozen objects, and a network from its chain ID, for
 * every entry point that takes one.
 *
 * @module
 */

import devnet from "../networks/devnet.json" with { type: "json" };
import mainnet from "../networks/mainnet.json" with { type: "json" };
import testnet from "../networks/testnet.json" with { type: "json" };

/** @typedef {import("./index.js").Network} Network */

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreeze(value) {
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
 * A network, or the one with that chain ID; throws for anything else.
 *
 * @param {unknown} net
 * @returns {Network}
 */
export function networkOf(net) {
  const network =
    net && typeof net === "object"
      ? /** @type {Network} */ (net)
      : networkFor(/** @type {number | bigint | string} */ (net));

  if (!network || typeof network.chainId !== "number" || !network.display) {
    throw new TypeError("Not one of the networks");
  }

  return network;
}
