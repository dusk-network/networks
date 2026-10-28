/** A Dusk contract ID: 64 lower-case hex digits, without 0x. */
export type ContractId = string;

/** A Dusk public account, base58. */
export type Account = string;

/** An EVM address: 0x and 40 hex digits, with its EIP-55 checksum. */
export type EvmAddress = `0x${string}`;

export type Currency = Readonly<{ name: string; symbol: string; decimals: number }>;

export type EvmChain = Readonly<{
  chainId: number;
  name: string;
  currency: Currency;
  rpcUrl: string;
  explorerUrl: string;
  /** The DUSK token on this chain. */
  token: EvmAddress;
  tokenLabel: string;
}>;

export type DuskEvm = Readonly<{
  /** The chain's name as wallets list it. */
  name: string;
  chainId: number;
  currency: Currency;
  rpcUrl: string;
  explorerUrl: string;
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
    migrations: ReadonlyArray<
      Readonly<{
        id: string;
        chain: string;
        contract: EvmAddress;
        payoutAccount: Account | null;
        typicalSeconds: number | null;
        running: boolean;
      }>
    >;
    services: ReadonlyArray<
      Readonly<{
        id: string;
        chain: string;
        account: Account;
        /** Lux, as a decimal string. */
        feeLux: string;
        typicalSeconds: number | null;
        running: boolean;
      }>
    >;
    duskEvm: ReadonlyArray<
      Readonly<{
        id: "dusk-to-dusk-evm" | "dusk-evm-to-dusk";
        direction: "deposit" | "withdrawal";
        typicalSeconds: number | null;
        running: boolean;
      }>
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
export type RouteChain = Readonly<{
  id: string;
  chainId: number;
  name: string;
  currency: Currency;
  rpcUrl: string;
  explorerUrl: string;
  token?: EvmAddress;
  tokenLabel?: string;
}>;

type RouteBase = Readonly<{
  id: string;
  from: string;
  to: string;
  chain: RouteChain;
  running: boolean;
  typicalSeconds: number | null;
}>;

export type Route =
  | (RouteBase &
      Readonly<{ kind: "migration"; contract: EvmAddress; payoutAccount: Account | null }>)
  | (RouteBase & Readonly<{ kind: "service"; account: Account; feeLux: bigint }>)
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
 * `<bridge>/#/move/<route>?to=<account>`, or null while the bridge has no
 * published address or the network has no such route. Throws on a route
 * name the bridge doesn't know (RangeError), or a `to` that isn't a Dusk
 * account (TypeError).
 */
export declare function bridgeLink(
  net: NetworkRef,
  options: { route: string; to?: string }
): string | null;
