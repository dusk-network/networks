// Types only: `tsc -p test-types` checks that the .d.ts files give an app
// what the code returns. It isn't run.
import { bridgeLink, isBlocked, labelFor, networkFor, networks, routeForAccount, routes, type Network, type Route } from "@dusk-network/networks";
import { HUB_NAME_ARGS, SOZU_GAS, isSozuCall, readSozuStatus, sozuStake, type SozuStatus } from "@dusk-network/networks/sozu";
import { nativeRateEstimate, sozuRateEstimate } from "@dusk-network/networks/rates";
import { aboutTime, aboutWords, durationWords, formatDusk, formatEvmAddress, formatTime, shortAccount } from "@dusk-network/networks/format";
import testnet from "@dusk-network/networks/networks/testnet.json" with { type: "json" };
import {
  BRIDGE_FUNCTIONS,
  GAME_STATUS,
  bridgeEnvelopeOk,
  claimFrom,
  claimReadiness,
  claimText,
  decodeBridgeCall,
  decodeWithdrawal,
  depositCall,
  duskEvmContracts,
  duskRecipientOf,
  encodeDepositArgs,
  evmAddressOf,
  isBridgeContract,
  isEligibleGame,
  type BridgeCall,
  type ClaimDate,
  type DuskRecipient,
} from "@dusk-network/networks/duskevm";
import { DEPOSIT_GAS, SOZU_GAS as GAS_SOZU, TRANSFER_GAS, WITHDRAWAL_GAS, withdrawalGasLimit } from "@dusk-network/networks/gas";
import { accountToRawKey, decodeBase58, encodeBase58, isAccount, rawKeyToAccount } from "@dusk-network/networks/account";

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
const adapter: string | undefined = net?.duskEvm?.l1AdapterUrl;
const tipNow = { height: 1n, timestamp: 2n };
const claim: ClaimDate = claimFrom({ game: { createdAt: 1n, maxClockDuration: 2n, resolvedAt: 0n, status: GAME_STATUS.IN_PROGRESS }, portal: { disputeGameFinalityDelaySeconds: 1n, proofMaturityDelaySeconds: 1n }, provenAt: null, tip: tipNow });
const readyAt: bigint | null = claimReadiness({ claim, portalAccepts: false, tip: tipNow }).readyAt;
const eligible: boolean = isEligibleGame({ createdAt: 1n, l2BlockNumber: 1n, proper: null, respected: true, status: 2 }, { respectedGameTypeUpdatedAt: 0n, withdrawalBlockNumber: 1n });
const route: Route | null = routeForAccount(1, "x", "out");
const payout: `0x${string}` | null | undefined = route?.kind === "service" ? route.payoutAddress : undefined;
const sozuCall: boolean = isSozuCall(2, { contractId: "ab", fnName: "sozu_stake" }, { pools: new Set(["ab"]) });
const words: string = `${aboutTime(60)} ${aboutWords(60n)} ${durationWords(60)} ${claimText(claim, (ms) => formatTime(ms))}`;
const bridgeCall: BridgeCall | null = decodeBridgeCall(2, { args: "00", contractId: "ab", fnName: BRIDGE_FUNCTIONS.deposit });
if (bridgeCall?.kind === "deposit") { const lux: bigint = bridgeCall.amountLux; void lux; }
if (bridgeCall?.kind === "prove") { const index: bigint = bridgeCall.disputeGameIndex; void index; }
if (bridgeCall && bridgeCall.kind !== "deposit") {
  const paid: DuskRecipient = bridgeCall.recipient;
  const hash: `0x${string}` = bridgeCall.hash;
  void [paid, hash];
}
const envelopeOk: boolean = bridgeEnvelopeOk(bridgeCall, { amount: 0n, deposit: "1", own: ["x"], to: "x" });
const withdrawn = decodeWithdrawal(2, { data: "0x", gasLimit: 1n, nonce: 1n, sender: "0x", target: "0x", value: "1" })?.from;
const recipient: DuskRecipient | null = duskRecipientOf(new Uint8Array(0));
const contracts = duskEvmContracts(networks.testnet);
const portal: string | undefined = contracts?.portal;
const isBridge: boolean = isBridgeContract(2, portal);
const evmOf: `0x${string}` = evmAddressOf("ab".repeat(32));
const args: Uint8Array = encodeDepositArgs({ amountLux: 1n, to: "0x00" });
const made = depositCall(2, { amountLux: "1", minGasLimit: 1, to: "0x00" });
const sent: bigint | undefined = made?.deposit;
const gasLimits: bigint[] = [DEPOSIT_GAS.minimum, TRANSFER_GAS.typical, WITHDRAWAL_GAS.limit, withdrawalGasLimit(1n), GAS_SOZU.sozu_unstake.limit];
const raw: Uint8Array | null = accountToRawKey("x");
const account: string | null = raw ? rawKeyToAccount(raw) : null;
const valid: boolean = isAccount(account);
const decoded: Uint8Array | null = decodeBase58(encodeBase58([0, 1]));
void [payout, sozuCall, words, envelopeOk, withdrawn, recipient, isBridge, evmOf, args, sent, gasLimits, valid, decoded];
void [adapter, readyAt, eligible, fromNetwork, same, label, blocked, link, gas, arg, ok, status, sozu, text, exact, time, evm, short, duskEvmChain];
// @ts-expect-error a direction is "in" or "out"
routeForAccount(1, "x", "self");
// @ts-expect-error a route needs a name
bridgeLink(networks.mainnet, {});
