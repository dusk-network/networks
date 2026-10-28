// Types only: `tsc -p test-types` checks that the .d.ts files give an app
// what the code returns. It isn't run.
import { bridgeLink, isBlocked, labelFor, networkFor, networks, routes, type Network, type Route } from "@dusk-network/networks";
import { HUB_NAME_ARGS, SOZU_GAS, readSozuStatus, sozuStake, type SozuStatus } from "@dusk-network/networks/sozu";
import { nativeRateEstimate, sozuRateEstimate } from "@dusk-network/networks/rates";
import { formatDusk, formatEvmAddress, formatTime, shortAccount } from "@dusk-network/networks/format";
import testnet from "@dusk-network/networks/networks/testnet.json" with { type: "json" };

const net: Network | null = networkFor(2);
const same: Network = testnet;
const label: string | null = labelFor(1, "0100");
const blocked: boolean = isBlocked(networks.mainnet, "x");
const list: ReadonlyArray<Route> = routes(networks.mainnet);
for (const route of list) {
  if (route.kind === "service") { const fee: bigint = route.feeLux; void fee; }
  if (route.kind === "migration") { const c: `0x${string}` = route.contract; void c; }
}
const link: string | null = bridgeLink(networks.mainnet, { route: "bsc", to: "abc" });
const gas: bigint = SOZU_GAS.sozu_stake.limit;
const arg: string = HUB_NAME_ARGS["staked-dusk"];
const quote = sozuStake(5n, { stake: 1n, supply: 1n }, { numerator: 1n, denominator: 400n });
const ok: boolean = quote.ok;
const status: Promise<SozuStatus> = readSozuStatus({ read: async () => new Uint8Array(0), contracts: { hub: "ab".repeat(32) } });
const fromNetwork: Promise<SozuStatus> | null = net?.sozu ? readSozuStatus({ read: () => new Uint8Array(33), contracts: net.sozu, account: null }) : null;
const native = nativeRateEstimate({ provisioners: [{ amount: 1, eligibility: 1 }], tipHeight: 2 });
const sozu: number | null = sozuRateEstimate(native, { numerator: 15n, denominator: 100n });
const { text, exact }: { text: string; exact: string } = formatDusk(1n, { mode: "short", round: "up" });
const time: string = formatTime(Date.now(), { date: "full", seconds: true, locale: "en", timeZone: "UTC" });
const evm: `0x${string}` = formatEvmAddress("0x" + "ab".repeat(20));
const short: string = shortAccount("abc");
const duskEvmChain: number | undefined = net?.duskEvm?.chainId;
void [fromNetwork, same, label, blocked, link, gas, arg, ok, status, sozu, text, exact, time, evm, short, duskEvmChain];
// @ts-expect-error a route needs a name
bridgeLink(networks.mainnet, {});
