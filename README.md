# @dusk-network/networks

What the Dusk apps need to know about each Dusk network, in one place: endpoints, contract IDs, bridge routes, labels and the recipient blocklist, one JSON file per network. It also holds the rules the apps share: Sozu's amounts and reads, reward-rate estimates, and how amounts, times and IDs are written.

The web wallet, the wallet extension, the explorer and the bridge use it.

## Install

From npm:

```sh
npm i @dusk-network/networks
```

From JSR, where it's `@dusk/networks`:

```sh
npx jsr add @dusk/networks
deno add jsr:@dusk/networks
```

The entry points are the same on both, under each registry's name: `@dusk-network/networks/format` on npm is `@dusk/networks/format` on JSR.

## Entry points

| Import | What it gives |
|---|---|
| `@dusk-network/networks` | `networks`, `networkFor(chainId)`, `labelFor(net, id)`, `isBlocked(net, account)`, `blockedReason(net, account)`, `routes(net)`, `bridgeLink(net, { route, to })` |
| `@dusk-network/networks/sozu` | Sozu's fee, stDUSK and minimum rules, its gas, the hub's argument bytes, the reply decoders and `readSozuStatus` |
| `@dusk-network/networks/rates` | `nativeRateEstimate` and `sozuRateEstimate`, as yearly fractions |
| `@dusk-network/networks/duskevm` | When a DuskEVM withdrawal can be claimed (`claimFrom`), whether it can be claimed now (`claimReadiness`), the games a proof can go against (`isEligibleGame`), and the contracts' clock |
| `@dusk-network/networks/format` | `formatDusk`, `formatDuskPlain`, `formatTime`, `formatContractId`, `shortAccount`, `formatEvmAddress` |
| `@dusk-network/networks/networks/<name>.json` | `mainnet`, `testnet` or `devnet` as data |
| `@dusk-network/networks/schema.json` | The files' JSON Schema |
| `@dusk-network/networks/fixtures/sozu-vectors.json` | The Sozu test vectors both wallets run |

Every entry point has its `.d.ts`. There are no runtime dependencies.

## Using it

- Pin an exact version, and import it at build time. The extension bundles it like any other module, so nothing is fetched at runtime.
- Find the network by the chain ID the node gives in `/on/node/info` (0 local, 1 mainnet, 2 testnet, 3 devnet), never by hostname. A custom node then gets its network's contracts and labels.

```js
import { labelFor, networkFor, routes } from "@dusk-network/networks";
import { formatDusk, formatTime } from "@dusk-network/networks/format";

const net = networkFor(info.chain_id); // null for a chain there's no file for
labelFor(net, contractId); // "Sozu relayer", or null
routes(net).filter((route) => route.running);
formatDusk(fee, { round: "up" }); // { text: "0.0019", exact: "0.001853542" }
formatTime(blockTime); // "Today, 14:05 CET"
```

Sozu's reads take the app's own `read(contractId, fnName, argBytes)`, so each app keeps its Multicall batcher:

```js
import { readSozuStatus, sozuStake } from "@dusk-network/networks/sozu";

const status = await readSozuStatus({ read, contracts: net.sozu, account });
sozuStake(amount, status.pool, status.fees?.deposit); // { fee, worth, stDusk, ok }
```

`account` is `balance_of`'s argument as the pool's data driver encodes it; leave it out to read no balances.

A stake or an unstake goes from a public account, at the node's gas price:

```js
import { SOZU_FN, SOZU_GAS, sozuCall } from "@dusk-network/networks/sozu";

const call = sozuCall(status.contracts.pool, SOZU_FN.STAKE, amount); // { contractId, deposit, fnArgs, fnName }
const { limit, minimum } = SOZU_GAS[call.fnName]; // warn while typing under the minimum
```

A DuskEVM withdrawal's claim date comes from the chain: the app reads the proof's dispute game on its hub, the Portal's two delays and Dusk's latest block, and `/duskevm` works out the date as the Portal checks a claim:

```js
import { claimFrom, claimReadiness } from "@dusk-network/networks/duskevm";

const claim = claimFrom({ provenAt, game, portal, tip }); // { at, exact, overdue }: "about" until the game resolves
claimReadiness({ claim, portalAccepts, tip }).ready; // the Portal's yes counts from the date only
```

The bridge takes a route and a Dusk recipient in its link. `bridgeLink` builds it, and gives null while the network's bridge has no published address:

```js
bridgeLink(net, { route: "migrate", to: account }); // "<bridge>/#/move/migrate?to=<account>", or null
```

## Read at runtime, not from here

The files hold the IDs an app starts from. These change without a release, so the apps read them live:

- Sozu's contracts behind its hub (`hub.contract(name)`): the guardian can name others at any time. The files' Sozu IDs are fallbacks until the hub answers.
- Sozu's fee rates and switches, from its substrate.
- DuskEVM's dispute games, and the portal's delays and respected game type.
- Dusk Domains' contracts, through its lens and its release manifest. The files only point at the manifest, with its sha256.

## Formats

- Dusk contract IDs are lower-case hex without 0x. EVM addresses carry their EIP-55 checksum.
- Short amounts have at most 4 decimals, but 2 significant digits under 0.01; exact amounts have all 9, without trailing zeros. Balances round down, fees up. Separators and digits are the locale's.
- Times are in English, with the locale's clock, a zone name and no seconds unless asked: "Today, 14:05 CET", "26 Oct, 09:12 CET", "Wed 28 Oct 2026, 14:05:09 CET".
- Accounts and contract IDs are cut to 6 characters at each end, EVM addresses to 0x and 4, and the last 4, with "…".

## Updating

1. Edit `networks/<name>.json`. `npm run validate` checks it against the schema, and `npm test` runs the rest.
2. DuskEVM's contracts come from [duskevm-genesis](https://github.com/dusk-network/duskevm-genesis): `node scripts/gen-duskevm.mjs <checkout>` writes them, and their labels. The name, endpoints, predeploys and drivers stay as written.
3. `node scripts/check-chain.mjs` reads each network once, through Multicall for Dusk: the hub must name the Sozu fallbacks, every other contract in the file must exist, and the Dusk Domains manifest must match its sha256. It sends nothing.
4. Release it, as below. The apps then bump their pin.

CI runs the version check, the schema, the tests, the type check (`npm run typecheck`), JSR's dry run (`npm run check:jsr`) and the genesis comparison on every push, and `check-chain` every week.

## Releasing

1. Set the new version in both `package.json` and `jsr.json`, and give it a section in `CHANGELOG.md`.
2. Tag the commit `vX.Y.Z` and push the tag.
3. The Publish workflow does the rest. It checks the tag against both versions, runs the tests, and publishes to JSR and to npm with provenance. Then it creates the GitHub release, from the version's CHANGELOG section and generated notes. Run again, it skips a registry that already has the version.

## Licence

MPL-2.0.
