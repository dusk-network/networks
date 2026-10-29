import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GAME_STATUS,
  OVERDUE_SECONDS,
  beforeProofText,
  claimAfterProving,
  claimFrom,
  claimReadiness,
  claimText,
  contractClock,
  contractNow,
  isCandidateGame,
  isEligibleGame,
  proveNowText,
  provingAfterSending,
  wallTime,
} from "../src/duskevm.js";
import { formatTime } from "../src/format.js";

// The test vectors both apps run for when a DuskEVM withdrawal can be
// claimed (the bridge's claim-date.test.js, the web wallet's
// claimDate.spec.js), and the claim states their withdrawal tests pin.
//
// Testnet's deployed contracts count Dusk block height × 10. The tip, as read
// on 28 Oct 2026: block 4,704,959 at 1,793,156,989 s, so a contract time S is
// at 1,746,107,399 + S on the wall clock.
const TIP = Object.freeze({ height: 4_704_959n, timestamp: 1_793_156_989n });
// The Portal's delays, as deployed on testnet; the hubs' clock limit is 302,400.
const PORTAL = Object.freeze({ disputeGameFinalityDelaySeconds: 302_400n, proofMaturityDelaySeconds: 604_800n });
const MAX_CLOCK = 302_400n;
// wallet-both.dusk's 1 DUSK withdrawal: proved at block 4,687,744; its game,
// created at block 4,687,605, can resolve from block 4,717,845.
const PROVEN_AT = 46_877_440n;
const GAME = Object.freeze({ createdAt: 46_876_050n, maxClockDuration: MAX_CLOCK, resolvedAt: 0n, status: 0 });

const iso = (/** @type {number | null} */ ms) => new Date(Number(ms)).toISOString().replace(".000", "");
/** The date as both apps write it, in Amsterdam, as of the examples' day. */
const when = (/** @type {number | null} */ ms, date = /** @type {"auto" | "full"} */ ("auto")) =>
  formatTime(Number(ms), { date, locale: "en-GB", now: Date.UTC(2026, 9, 28), timeZone: "Europe/Amsterdam" });

describe("the claim date", () => {
  it("the worked example: claimable on Mon 2 Nov, 03:20 to 03:32 UTC", () => {
    // In progress: the earliest, the proof's maturity, as an estimate.
    const now = claimFrom({ game: GAME, portal: PORTAL, provenAt: PROVEN_AT, tip: TIP });

    assert.deepEqual({ ...now, at: iso(now.at) }, { at: "2026-11-02T03:20:39Z", exact: false, overdue: false });
    assert.equal(when(now.at), "2 Nov, 04:20 CET");
    assert.equal(when(now.at, "full"), "Mon 2 Nov 2026, 04:20 CET");

    // Resolved 139 blocks or less after its earliest: still the maturity.
    // At the resolver's median (161 blocks) and 90th percentile (205), later: exact.
    const resolvedAfter = (/** @type {bigint} */ blocks) =>
      claimFrom({
        game: { ...GAME, resolvedAt: GAME.createdAt + MAX_CLOCK + 10n * blocks, status: 2 },
        portal: PORTAL,
        provenAt: PROVEN_AT,
        tip: TIP,
      });

    assert.deepEqual(
      [139n, 161n, 205n].map((blocks) => iso(resolvedAfter(blocks).at)),
      ["2026-11-02T03:20:39Z", "2026-11-02T03:24:19Z", "2026-11-02T03:31:39Z"]
    );
    assert.equal(resolvedAfter(161n).exact, true);
    assert.equal(when(resolvedAfter(161n).at), "2 Nov, 04:24 CET");
  });

  it("a resolved game: exact, the later of the proof's maturity and the game's finality", () => {
    // The 1,008 DUSK withdrawal: proved at block 4,525,232, its game resolved
    // at 4,555,501; claimable since block 4,585,741 (~14 Oct, 08:00 UTC).
    const game = { createdAt: 45_250_000n, maxClockDuration: MAX_CLOCK, resolvedAt: 45_555_010n, status: 2 };
    const claim = claimFrom({ game, portal: PORTAL, provenAt: 45_252_320n, tip: TIP });

    assert.deepEqual({ ...claim, at: iso(claim.at) }, { at: "2026-10-14T08:00:09Z", exact: true, overdue: false });

    // Proving now against a resolved game: exactly the maturity from now.
    const proveNow = claimFrom({ game, portal: PORTAL, tip: TIP });

    assert.equal(proveNow.at, Number(TIP.timestamp + PORTAL.proofMaturityDelaySeconds) * 1_000);
    // The tip is 28 Oct, 03:09:49 UTC.
    assert.equal(when(proveNow.at), "4 Nov, 04:09 CET");
  });

  it("an unresolved game: the earliest it can be final, as an estimate", () => {
    // Proved long after the game was created: its finality comes first.
    const late = claimFrom({ game: GAME, portal: PORTAL, provenAt: 47_040_000n, tip: TIP });

    assert.equal(late.exact, false);
    assert.equal(late.at, wallTime(47_040_000n + 604_800n, "height", TIP));

    // Proved right after: createdAt + maxClockDuration + finality is later than the maturity.
    const early = claimFrom({
      game: { ...GAME, createdAt: 46_877_430n },
      portal: { ...PORTAL, disputeGameFinalityDelaySeconds: 302_420n },
      provenAt: 46_877_440n,
      tip: TIP,
    });

    assert.equal(early.at, wallTime(46_877_430n + 302_400n + 302_420n, "height", TIP));

    // Before proving, against the newest game: an estimate.
    assert.equal(claimFrom({ game: { ...GAME, createdAt: 47_048_050n }, portal: PORTAL, tip: TIP }).exact, false);
  });

  it("an overdue game: unresolved more than an hour past its clock, claimable at the soonest a finality from now", () => {
    const settles = GAME.createdAt + MAX_CLOCK;
    const at = (/** @type {bigint} */ blocksPast) => {
      const height = settles / 10n + blocksPast;

      return { height, timestamp: TIP.timestamp + 10n * (height - TIP.height) };
    };

    // An hour past (360 blocks) isn't overdue yet; a block more is.
    assert.equal(OVERDUE_SECONDS, 3_600n);
    assert.equal(claimFrom({ game: GAME, portal: PORTAL, provenAt: PROVEN_AT, tip: at(360n) }).overdue, false);

    const overdue = claimFrom({ game: GAME, portal: PORTAL, provenAt: PROVEN_AT, tip: at(361n) });

    assert.equal(overdue.overdue, true);
    assert.equal(overdue.exact, false);
    // It could resolve now: final 3.5 days from now, after the maturity.
    assert.equal(overdue.at, Number(at(361n).timestamp + PORTAL.disputeGameFinalityDelaySeconds) * 1_000);
    assert.equal(when(overdue.at), "2 Nov, 04:57 CET");
  });

  it("a master-style deployment: block timestamps, compared strictly, so a second later", () => {
    const tip = { height: 5_600_000n, timestamp: 1_793_400_000n };
    const game = { createdAt: 1_792_990_000n, maxClockDuration: MAX_CLOCK, resolvedAt: 1_793_300_000n, status: 2 };

    assert.equal(contractClock(game.createdAt, tip), "timestamp");
    assert.equal(contractClock(GAME.createdAt, TIP), "height");
    // The proof matures at 1,793,604,800, after the game's finality at 1,793,602,400: one second later.
    assert.deepEqual(claimFrom({ game, portal: PORTAL, provenAt: 1_793_000_000n, tip }), {
      at: 1_793_604_801_000,
      exact: true,
      overdue: false,
    });
    // Resolved late: the game's finality is the later gate, a second after the delay.
    assert.equal(
      claimFrom({ game: { ...game, resolvedAt: 1_793_400_000n }, portal: PORTAL, provenAt: 1_793_000_000n, tip }).at,
      (1_793_400_000 + 302_400 + 1) * 1_000
    );
    // Unresolved: an estimate, from the proof's maturity here.
    assert.deepEqual(
      claimFrom({
        game: { ...game, resolvedAt: 0n, status: 0 },
        portal: PORTAL,
        provenAt: 1_793_000_000n,
        tip: { ...tip, timestamp: 1_793_000_100n },
      }),
      { at: (1_793_000_000 + 604_800 + 1) * 1_000, exact: false, overdue: false }
    );
  });

  it("gives no date when the challenger won, the hub doesn't know the game, or it couldn't be read", () => {
    const none = { at: null, exact: false, overdue: false };

    assert.deepEqual(claimFrom({ game: { ...GAME, status: 1 }, portal: PORTAL, provenAt: PROVEN_AT, tip: TIP }), none);
    assert.deepEqual(claimFrom({ game: { ...GAME, createdAt: 0n }, portal: PORTAL, provenAt: PROVEN_AT, tip: TIP }), none);
    assert.deepEqual(claimFrom({ game: null, portal: PORTAL, provenAt: PROVEN_AT, tip: TIP }), none);
  });

  it("keeps an explicit clock, and the contracts' time at the tip", () => {
    assert.equal(contractNow("height", TIP), 47_049_590n);
    assert.equal(contractNow("timestamp", TIP), 1_793_156_989n);
    assert.equal(wallTime(47_049_590n, "height", TIP), 1_793_156_989_000);
    assert.equal(wallTime(1_793_156_989, "timestamp", TIP), 1_793_156_989_000);
    // Told the deployment counts block time, it isn't read from the game's
    // own time: the game, long past its clock on that count, can resolve
    // now, so it's final a finality from now, a second later.
    assert.deepEqual(claimFrom({ clock: "timestamp", game: GAME, portal: PORTAL, provenAt: PROVEN_AT, tip: TIP }), {
      at: Number(TIP.timestamp + 302_400n + 1n) * 1_000,
      exact: false,
      overdue: true,
    });
  });
});

describe("whether a proven withdrawal can be claimed now", () => {
  const ready = (/** @type {Parameters<typeof claimFrom>[0]} */ input, /** @type {boolean} */ portalAccepts) =>
    claimReadiness({ claim: claimFrom(input), portalAccepts, tip: input.tip });

  it("isn't ready before its date, even when the Portal's check says yes (the bridge)", () => {
    // A Portal whose check takes just the proof and its game says yes on
    // 28 Oct, for a proof that matures, and a game final, on 2 Nov.
    const early = ready({ game: { ...GAME, resolvedAt: 47_180_060n, status: 2 }, portal: PORTAL, provenAt: PROVEN_AT, tip: TIP }, true);

    assert.deepEqual([early.ready, early.readyAtExact, early.claimOverdue], [false, true, false]);
    assert.equal(iso(Number(early.readyAt) * 1_000), "2026-11-02T03:24:19Z");

    // From its date, the Portal's yes counts.
    const claimable = { createdAt: 45_250_000n, maxClockDuration: MAX_CLOCK, resolvedAt: 45_555_010n, status: 2 };

    assert.equal(ready({ game: claimable, portal: PORTAL, provenAt: 45_252_320n, tip: TIP }, true).ready, true);
  });

  it("dates a waiting claim as the web wallet's withdrawal tests do", () => {
    // Block time: proven at 100, the game created at 50.
    const tip = { height: 1_000_000n, timestamp: 200n };
    const game = { createdAt: 50n, maxClockDuration: MAX_CLOCK, resolvedAt: 0n, status: 0 };

    // In progress: it matures at 604,900, a second later on block time.
    assert.deepEqual(ready({ game, portal: PORTAL, provenAt: 100n, tip }, false), {
      claimOverdue: false,
      ready: false,
      readyAt: 604_901n,
      readyAtExact: false,
      refused: false,
    });
    // Resolved: final at 400,000 + 302,400, after the proof matures.
    assert.deepEqual(
      [ready({ game: { ...game, resolvedAt: 400_000n, status: 2 }, portal: PORTAL, provenAt: 100n, tip }, false)].map((r) => [r.readyAt, r.readyAtExact]),
      [[702_401n, true]]
    );
    // Testnet's height clock: wallet-both.dusk's withdrawal.
    assert.equal(
      ready({ game: GAME, portal: PORTAL, provenAt: PROVEN_AT, tip: TIP }, false).readyAt,
      BigInt(Date.UTC(2026, 10, 2, 3, 20, 39) / 1_000)
    );
    // Late to resolve: claimable at the soonest a finality from now.
    const late = ready({ game: { ...GAME, createdAt: 46_000_000n }, portal: PORTAL, provenAt: 46_100_000n, tip: TIP }, false);

    assert.deepEqual([late.claimOverdue, late.readyAt, late.readyAtExact], [true, TIP.timestamp + 302_400n, false]);
  });

  it("gives no date once it has passed while the Portal still refuses the claim", () => {
    const tip = { height: 1_000_000n, timestamp: 2_000_000n };
    const game = { createdAt: 50n, maxClockDuration: MAX_CLOCK, resolvedAt: 100n, status: 2 };

    assert.deepEqual(ready({ game, portal: { ...PORTAL, proofMaturityDelaySeconds: 0n }, provenAt: 100n, tip }, false), {
      claimOverdue: false,
      ready: false,
      readyAt: null,
      readyAtExact: false,
      refused: true,
    });
  });

  it("is ready once the Portal takes it and its date has come, and without a date when its game can't be read", () => {
    const tip = { height: 1_000_000n, timestamp: 2_000_000n };
    const game = { createdAt: 50n, maxClockDuration: MAX_CLOCK, resolvedAt: 400n, status: 2 };

    assert.deepEqual(ready({ game, portal: { ...PORTAL, proofMaturityDelaySeconds: 0n }, provenAt: 100n, tip }, true), {
      claimOverdue: false,
      ready: true,
      readyAt: 302_801n,
      readyAtExact: true,
      refused: false,
    });
    assert.equal(claimReadiness({ claim: null, portalAccepts: true, tip }).ready, true);
    assert.deepEqual(claimReadiness({ claim: null, portalAccepts: false, tip }), {
      claimOverdue: false,
      ready: false,
      readyAt: null,
      readyAtExact: false,
      refused: false,
    });
  });

  it("where the web wallet differs: its Portal's yes before the date was ready", () => {
    // The web wallet's "is ready to claim once the Portal takes the claim":
    // the date, 302,801, is still ahead of the tip, 200, so the bridge's rule
    // waits for it.
    const tip = { height: 1_000_000n, timestamp: 200n };
    const game = { createdAt: 50n, maxClockDuration: MAX_CLOCK, resolvedAt: 400n, status: 2 };
    const state = ready({ game, portal: { ...PORTAL, proofMaturityDelaySeconds: 0n }, provenAt: 100n, tip }, true);

    assert.deepEqual([state.ready, state.readyAt, state.readyAtExact], [false, 302_801n, true]);
  });
});

describe("the games a proof can go against", () => {
  const rules = { respectedGameTypeUpdatedAt: 1_000n, withdrawalBlockNumber: 500n };
  const game = { createdAt: 1_001n, l2BlockNumber: 500n, proper: true, respected: true, status: GAME_STATUS.DEFENDER_WINS };

  it("takes a resolved game, proper and respected, that covers the withdrawal and came after the game type changed", () => {
    assert.equal(isCandidateGame(game, rules), true);
    assert.equal(isEligibleGame(game, rules), true);
    assert.equal(isEligibleGame({ ...game, status: 2 }, { respectedGameTypeUpdatedAt: 1_000, withdrawalBlockNumber: 500 }), true);
  });

  it("passes over any other", () => {
    for (const [change, why] of /** @type {const} */ ([
      [{ createdAt: 1_000n }, "created when the respected game type changed"],
      [{ createdAt: 999n }, "created before it"],
      [{ l2BlockNumber: 499n }, "doesn't cover the withdrawal"],
      [{ status: GAME_STATUS.IN_PROGRESS }, "in progress"],
      [{ status: GAME_STATUS.CHALLENGER_WINS }, "the challenger won"],
      [{ status: null }, "its status unread"],
      [{ proper: false }, "not proper"],
      [{ proper: null }, "properness unread"],
      [{ respected: false }, "not respected"],
      [{ respected: null }, "respect unread"],
    ])) {
      assert.equal(isEligibleGame({ ...game, ...change }, rules), false, why);
    }

    assert.equal(isCandidateGame({ ...game, createdAt: 1_000n }, rules), false);
    assert.equal(isCandidateGame({ ...game, l2BlockNumber: 499n }, rules), false);
  });
});

describe("a claim date in words, as the bridge and the web wallet write it", () => {
  it("after the proof: the date, about until its game resolves", () => {
    const now = claimFrom({ game: GAME, portal: PORTAL, provenAt: PROVEN_AT, tip: TIP });
    // Resolved at the resolver's median, 161 blocks after its earliest.
    const resolved = claimFrom({
      game: { ...GAME, resolvedAt: GAME.createdAt + MAX_CLOCK + 1_610n, status: 2 },
      portal: PORTAL,
      provenAt: PROVEN_AT,
      tip: TIP,
    });

    assert.equal(claimText(now, when), "Claim from about 2 Nov, 04:20 CET");
    assert.equal(claimText(resolved, when), "Claim from 2 Nov, 04:24 CET");
    assert.equal(claimText({ at: Date.UTC(2026, 10, 2, 3, 20, 39), exact: false, overdue: false }, when), "Claim from about 2 Nov, 04:20 CET");
    assert.equal(claimText({ at: null }, when), "");
    assert.equal(claimText(null, when), "");
  });

  it("at the soonest, once its game is late to resolve", () => {
    const settles = GAME.createdAt + MAX_CLOCK;
    // A block more than an hour (360 blocks) past its clock.
    const height = settles / 10n + 361n;
    const overdue = claimFrom({
      game: GAME,
      portal: PORTAL,
      provenAt: PROVEN_AT,
      tip: { height, timestamp: TIP.timestamp + 10n * (height - TIP.height) },
    });

    assert.equal(claimText(overdue, when), "Waiting for DuskEVM to settle this proof. Claim from 2 Nov, 04:57 CET at the soonest.");
    assert.equal(
      claimText({ at: Date.UTC(2026, 10, 2, 3, 57, 39), exact: false, overdue: true }, when),
      "Waiting for DuskEVM to settle this proof. Claim from 2 Nov, 04:57 CET at the soonest."
    );
  });

  it("on the prove review: when a proof made now can be claimed", () => {
    // Against a resolved game: exactly the maturity from now. The tip is 28 Oct, 03:09:49 UTC.
    const resolved = claimFrom({ game: { ...GAME, resolvedAt: 45_555_010n, status: 2 }, portal: PORTAL, tip: TIP });
    // Against the newest game: an estimate.
    const newest = claimFrom({ game: { ...GAME, createdAt: 47_048_050n }, portal: PORTAL, tip: TIP });

    assert.equal(proveNowText(resolved, when), "If you prove now, you can claim from 4 Nov, 04:09 CET");
    assert.match(proveNowText(newest, when), /^If you prove now, you can claim from about /u);
    assert.equal(proveNowText({ ...resolved, exact: false }, when), "If you prove now, you can claim from about 4 Nov, 04:09 CET");
    assert.equal(proveNowText(null, when), "");
  });

  it("before the proof: the wait, from what the chain said", () => {
    assert.equal(beforeProofText({ maturity: 604_800, prove: 1_700 }), "Claim 7 days after you prove. You can prove about 30 minutes after sending.");
    assert.equal(beforeProofText({ maturity: 302_400 }), "Claim 3 days 12 hours after you prove.");
    assert.equal(beforeProofText({ prove: 1_700 }), "");
    assert.equal(beforeProofText(null), "");
    assert.equal(claimAfterProving(PORTAL.proofMaturityDelaySeconds), "Claim 7 days after you prove.");
    assert.equal(provingAfterSending(60), "You can prove about 1 minute after sending.");
    assert.equal(provingAfterSending(3_600), "You can prove about 1 hour after sending.");
  });
});
