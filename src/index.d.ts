/**
 * Dusk's networks for the Dusk apps: each network's endpoints, contract IDs,
 * bridge routes, labels and recipient blocklist. Find a network by the chain
 * ID its node gives in `/on/node/info`, never by hostname.
 *
 * @example
 * ```js
 * import { bridgeLink, labelFor, networkFor, routeForAccount, routes } from "@dusk/networks";
 *
 * const net = networkFor(2); // testnet
 * labelFor(net, "51ced4fad52fc590def2736969c9e3e30013275a996c53714b81d8a08774aa37"); // "Sozu relayer"
 * routes(net).filter((route) => route.running).map((route) => route.id); // ["dusk-to-dusk-evm", "dusk-evm-to-dusk"]
 * routeForAccount(1, transfer.to, "out")?.id; // "dusk-to-bsc": a transfer to the BSC bridge's account
 * bridgeLink(net, { route: "duskevm" }); // "https://bridge.testnet.dusk.network/#/move/duskevm"
 * ```
 *
 * @module
 */

/** A Dusk contract ID: 64 lower-case hex digits, without 0x. */
export type ContractId = string;

/** A Dusk public account, base58. */
export type Account = string;

/** An EVM address: 0x and 40 hex digits, with its EIP-55 checksum. */
export type EvmAddress = `0x${string}`;

/** A chain's own coin, as wallets list it. */
export type Currency = Readonly<{ name: string; symbol: string; decimals: number }>;

/** What every EVM chain here has: its ID, name, coin, RPC and explorer. */
export type ChainFields = Readonly<{
  chainId: number;
  name: string;
  currency: Currency;
  rpcUrl: string;
  explorerUrl: string;
}>;

/** Whether a route runs, and how long it usually takes, in seconds. */
export type RouteState = Readonly<{ typicalSeconds: number | null; running: boolean }>;

/** A migration or a service as a network file holds it, by the ID of the chain it reaches. */
export type ChainRoute = RouteState & Readonly<{ id: string; chain: string }>;

/** An EVM chain a route reaches, with the DUSK token there. */
export type EvmChain = ChainFields &
  Readonly<{
    /** The DUSK token on this chain. */
    token: EvmAddress;
    tokenLabel: string;
  }>;

/** DuskEVM, the EVM chain that settles on a network. */
export type DuskEvm = ChainFields &
  Readonly<{
    /** The chain's name as wallets list it. */
    name: string;
    /** The DuskEVM adapter's RPC beside the chain's own, which the bridge asks which DuskEVM deposit a Dusk transaction made. */
    l1AdapterUrl: string;
    blockscoutApiUrl: string;
    predeploys: Readonly<{
      l1Block: EvmAddress;
      l2CrossDomainMessenger: EvmAddress;
      l2StandardBridge: EvmAddress;
      l2ToL1MessagePasser: EvmAddress;
    }>;
    drivers: Readonly<{
      disputeGameFactory: Readonly<{ file: string; sha256: string }>;
      optimismPortal: Readonly<{ file: string; sha256: string }>;
    }>;
    /** Every DuskEVM contract on Dusk, by its name in duskevm-genesis. */
    contracts: Readonly<Record<string, Readonly<{ contractId: ContractId; evmAddress: EvmAddress }>>>;
    source: Readonly<{ files: Readonly<Record<string, string>>; repository: string }>;
  }>;

/** One network's file, as `networks/<name>.json` holds it. */
export type Network = Readonly<{
  /** 0 local, 1 mainnet, 2 testnet, 3 devnet: as /on/node/info gives it. */
  chainId: 0 | 1 | 2 | 3;
  name: "local" | "mainnet" | "testnet" | "devnet";
  label: string;
  urls: Readonly<{ node: string; archive: string; prover: string }>;
  /** Where each app is published; null where it isn't yet. */
  apps: Readonly<{ wallet: string | null; explorer: string | null; bridge: string | null }>;
  contracts: Readonly<{ transfer: ContractId; stake: ContractId; multicall: ContractId | null }>;
  /** Sozu's hub and the contracts it named when this was written: read the hub, use these until it answers. */
  sozu: Readonly<{
    hub: ContractId;
    fallbacks: Readonly<{
      pool: ContractId;
      relayer: ContractId;
      stDusk: ContractId;
      substrate: ContractId;
      vault: ContractId;
    }>;
  }> | null;
  /** Where Dusk Domains' release manifest is published. */
  duskDomains: Readonly<{
    site: string;
    manifest: Readonly<{ version: string; url: string; sha256: string }>;
  }> | null;
  duskEvm: DuskEvm | null;
  routes: Readonly<{
    chains: Readonly<Record<string, EvmChain>>;
    migrations: ReadonlyArray<ChainRoute & Readonly<{ contract: EvmAddress; payoutAccount: Account | null }>>;
    services: ReadonlyArray<
      ChainRoute &
        Readonly<{
          account: Account;
          /** The address on the chain that pays the route out, where it's known. */
          payoutAddress: EvmAddress | null;
          /** Lux, as a decimal string. */
          feeLux: string;
        }>
    >;
    duskEvm: ReadonlyArray<
      RouteState &
        Readonly<{ id: "dusk-to-dusk-evm" | "dusk-evm-to-dusk"; direction: "deposit" | "withdrawal" }>
    >;
    /** Migration contracts no longer offered. */
    retired: ReadonlyArray<Readonly<{ chain: string; contract: EvmAddress; token: EvmAddress }>>;
  }>;
  operator: Readonly<{ name: string; termsUrl: string; privacyUrl: string }>;
  display: Readonly<{
    /** Names by contract ID or account. */
    labels: Readonly<Record<string, string>>;
    blocklist: ReadonlyArray<Readonly<{ account: Account; reason: "compromised" | "scam" }>>;
  }>;
}>;

/** The chain a route reaches, with its ID ("bsc", "ethereum", "dusk-evm"). */
export type RouteChain = ChainFields &
  Readonly<{ id: string; token?: EvmAddress; tokenLabel?: string }>;

/** What every route `routes` gives has. */
export type RouteBase = RouteState & Readonly<{ id: string; from: string; to: string; chain: RouteChain }>;

/** A route between Dusk and an EVM chain, as `routes` gives it, with the chain it reaches. */
export type Route =
  | (RouteBase &
      Readonly<{ kind: "migration"; contract: EvmAddress; payoutAccount: Account | null }>)
  | (RouteBase &
      Readonly<{ kind: "service"; account: Account; payoutAddress: EvmAddress | null; feeLux: bigint }>)
  | (RouteBase & Readonly<{ kind: "duskevm-deposit" | "duskevm-withdrawal" }>);

/** A network, or its chain ID. */
export type NetworkRef = Network | number | bigint | string;

/** Every network there's a file for, by name. */
export declare const networks: Readonly<{ mainnet: Network; testnet: Network; devnet: Network }>;

/** The network with this chain ID (a number, the same as a string, or "dusk:2"), or null. */
export declare function networkFor(chainId: number | bigint | string): Network | null;

/** What the explorer and Activity call a contract or an account, or null. */
export declare function labelFor(net: NetworkRef, id: string): string | null;

/** Why the apps don't send to an account, or null when they do. */
export declare function blockedReason(net: NetworkRef, account: string): "compromised" | "scam" | null;

/** Whether the apps refuse to send to an account. */
export declare function isBlocked(net: NetworkRef, account: string): boolean;

/** The network's routes, running or not. */
export declare function routes(net: NetworkRef): ReadonlyArray<Route>;

/**
 * The route a transfer with one of the bridge's accounts is on: "out", DUSK
 * sent to a service route's account; "in", DUSK received from a migration's
 * payout account. Null for any other account. One account can be both, as
 * BSC's is on mainnet, so the direction picks. Throws a RangeError for any
 * other direction.
 */
export declare function routeForAccount(
  net: NetworkRef,
  account: string,
  direction: "in" | "out"
): Route | null;

/**
 * `<bridge>/#/move/<route>?to=<account>`, with `route` a route's ID
 * ("bsc-to-dusk") or one of the bridge's names: "bsc", "ethereum",
 * "duskevm", "migrate". Null while the bridge has no published address or
 * the network has no such route. Throws on a route name the bridge doesn't
 * know (RangeError), or a `to` that isn't a Dusk account (TypeError).
 */
export declare function bridgeLink(
  net: NetworkRef,
  options: { route: string; to?: string }
): string | null;
