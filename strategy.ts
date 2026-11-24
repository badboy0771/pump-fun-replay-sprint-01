// Launch Rider — a pump.fun replay bot (agent-fun/replay/v2).
//
// Idea: most new pump.fun coins dump within minutes, so chasing momentum
// loses a little on almost every coin. The money is in the rare coin that
// keeps running toward curve completion. This bot therefore buys a small,
// fixed stake in many fresh launches that pass a rug filter, then rides
// each one with a wide stop and a trailing stop instead of taking a quick
// profit. Losers cost at most the stake; a runner pays for dozens of them.
//
// Entry (decided in the first few slots after a coin is created):
//   - the creator has not sold, and the creator's own buy in the create
//     slot is not absurdly large (a huge dev buy is usually a bundle);
//   - only a handful of distinct non-creator buyers piled in at launch
//     (a launch bundled by many wallets is a dump waiting to happen);
//   - the curve already holds a meaningful amount of real SOL;
//   - no single non-creator sell is large next to the reserve, and total
//     sells are not already outrunning buys.
// Exit (checked every batch while holding):
//   - hard stop at -50% of cost;
//   - trailing stop: once the position is up 20%, sell if it falls 30%
//     from its best value;
//   - the creator sells while we hold;
//   - otherwise hold — the replay closes the position when the curve
//     completes, which is where the big wins live.
// A 100_000-slot hold cap is effectively "never": it only guards against
// a position lingering forever if the curve stalls without completing.
//
// Parameters were picked by sweeping the kit's dev window with the local
// engine (see STRATEGY.md): the shipped cell is the one with the best
// mean net PnL across several failed-transaction draws while keeping
// drawdown tiny and the win spread over several coins, not one.
//
// Deterministic by construction: no clock, no randomness, no I/O — only
// insertion-ordered maps fed by the batch stream, so the grader's two
// executions produce byte-identical action logs.

import { BPS, type Batch, type Bot, type BotState, type OrderInput, type Pubkey } from './vendor/agentfun-bot.ts';

export interface Params {
  /** Youngest age (slots since create) at which a coin may be bought. */
  minAgeSlots: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAgeSlots: number;
  /** Lamports to aim for per coin (each order is still capped at 1% of real SOL). */
  stakeLamports: number;
  /** Smallest single buy worth paying the transaction fee for. */
  minBuyLamports: number;
  /** Real SOL reserve window at decision time (lamports). */
  minRealSolLamports: number;
  maxRealSolLamports: number;
  /** Creator's own buys in the create slot: lamports window. */
  minDevBuyLamports: number;
  maxDevBuyLamports: number;
  /** Trades seen and distinct (non-creator) buyers seen before entry. */
  minTrades: number;
  minBuyers: number;
  /** Distinct non-creator buyers before entry, at most. */
  maxBuyers: number;
  /** Lamports sold by others / lamports bought, as bps, at most. */
  maxSellRatioBps: number;
  /** Largest single non-creator sell seen, as bps of the real SOL reserve before it, at most. */
  maxBigSellBps: number;
  /** Price now over the create price, as bps: window. */
  minRunupBps: number;
  maxRunupBps: number;
  /** Slippage allowed on buys (bps). */
  buySlippageBps: number;
  /** Exit when the position is worth this much under its cost (bps). */
  stopLossBps: number;
  /** Trailing stop: once up at least this much, exit on a fall of this much from the best value (bps). */
  trailArmBps: number;
  trailBps: number;
  /** Exit after holding this many slots. */
  maxHoldSlots: number;
  /** Exit when the creator sells while held. */
  exitOnCreatorSell: boolean;
  /** Creator sold before entry: skip the coin. */
  skipCreatorSold: boolean;
}

/** Shipped settings — swept on the dev window, see STRATEGY.md. */
export const DEFAULT_PARAMS: Params = {
  minAgeSlots: 0,
  maxAgeSlots: 3,
  stakeLamports: 50_000_000,
  minBuyLamports: 5_000_000,
  minRealSolLamports: 300_000_000,
  maxRealSolLamports: 30_000_000_000,
  minDevBuyLamports: 0,
  maxDevBuyLamports: 2_500_000_000,
  minTrades: 0,
  minBuyers: 0,
  maxBuyers: 5,
  maxSellRatioBps: 10_000,
  maxBigSellBps: 10_000,
  minRunupBps: 0,
  maxRunupBps: 1_000_000,
  buySlippageBps: 10_000,
  stopLossBps: 5_000,
  trailArmBps: 2_000,
  trailBps: 3_000,
  maxHoldSlots: 100_000,
  exitOnCreatorSell: true,
  skipCreatorSold: true,
};

const LAMPORTS = 1_000_000_000n;
/** Curve fee on a sale: protocol 95 bps + creator 30 bps. */
const CURVE_FEE_BPS = 125n;

interface LaunchTick {
  slot: number;
  isBuy: boolean;
  sol: bigint;
  user: Pubkey;
}

/** Everything remembered about one fresh launch. */
interface Launch {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  /** Reserves at creation, for the run-up check. */
  createVq: bigint;
  createVt: bigint;
  /** Creator's own buys in the create slot. */
  devBuy: bigint;
  /** Creator sold at any point. */
  creatorSold: boolean;
  trades: number;
  buyers: Set<Pubkey>;
  bought: bigint;
  soldByOthers: bigint;
  /** Largest single non-creator sell, in bps of the reserve before it. */
  bigSellBps: bigint;
  lastTradeSlot: number;
  /** Never consider this coin again (decided, exited, or completed). */
  done: boolean;
}

/** A position we hold, with the state its exits need. */
interface Ride {
  openedSlot: number;
  /** Best close value seen so far (lamports, after curve fee). */
  bestValue: bigint;
  /** True once a sell for this position is already in flight. */
  selling: boolean;
}

/** What selling `tokens` against reserves (vq, vt) pays after the curve fee. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const quote = (tokens * vq) / (vt + tokens);
  return quote - (quote * CURVE_FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): Bot {
  const P = params;
  const launches = new Map<Pubkey, Launch>();
  const rides = new Map<Pubkey, Ride>();
  const selling = new Set<Pubkey>();

  /** Fold one batch of chain events into the launch records. */
  function observe(batch: Batch): void {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        if (!launches.has(e.mint)) {
          launches.set(e.mint, {
            mint: e.mint,
            createSlot: e.slot,
            creator: e.creator,
            createVq: BigInt(e.virtual_quote_reserves),
            createVt: BigInt(e.virtual_token_reserves),
            devBuy: 0n,
            creatorSold: false,
            trades: 0,
            buyers: new Set(),
            bought: 0n,
            soldByOthers: 0n,
            bigSellBps: 0n,
            lastTradeSlot: e.slot,
            done: false,
          });
        }
        continue;
      }
      if (e.event !== 'TradeEvent') continue;
      const launch = launches.get(e.mint);
      if (launch === undefined) continue;
      const sol = BigInt(e.sol_amount);
      const isCreator = e.user === launch.creator;
      launch.trades += 1;
      launch.lastTradeSlot = e.slot;
      if (e.is_buy) {
        launch.bought += sol;
        if (isCreator && e.slot === launch.createSlot) launch.devBuy += sol;
        if (!isCreator) launch.buyers.add(e.user);
      } else {
        if (isCreator) {
          launch.creatorSold = true;
        } else {
          launch.soldByOthers += sol;
          // Reserve before this sell: the trade's own SOL has just left it.
          const reserveBefore = BigInt(e.real_quote_reserves) + sol;
          if (reserveBefore > 0n) {
            const bps = (sol * BPS) / reserveBefore;
            if (bps > launch.bigSellBps) launch.bigSellBps = bps;
          }
        }
      }
    }
  }

  /** Does this fresh launch pass the rug filter at slot `now`? */
  function qualifies(launch: Launch, now: number, curve: { real_quote_reserves: string; virtual_quote_reserves: string; virtual_token_reserves: string } | undefined): boolean {
    if (launch.done || curve === undefined) return false;
    const age = now - launch.createSlot;
    if (age < P.minAgeSlots || age > P.maxAgeSlots) return false;
    if (P.skipCreatorSold && launch.creatorSold) return false;
    if (launch.devBuy < BigInt(P.minDevBuyLamports) || launch.devBuy > BigInt(P.maxDevBuyLamports)) return false;
    if (launch.trades < P.minTrades || launch.buyers.size < P.minBuyers) return false;
    if (launch.buyers.size > P.maxBuyers) return false;
    const realSol = BigInt(curve.real_quote_reserves);
    if (realSol < BigInt(P.minRealSolLamports) || realSol > BigInt(P.maxRealSolLamports)) return false;
    if (launch.bought > 0n) {
      const sellRatio = (launch.soldByOthers * BPS) / launch.bought;
      if (sellRatio > BigInt(P.maxSellRatioBps)) return false;
    } else if (launch.soldByOthers > 0n) {
      return false;
    }
    if (launch.bigSellBps > BigInt(P.maxBigSellBps)) return false;
    // Run-up vs the create price, as a ratio in bps (10_000 = unchanged):
    // a coin that dipped below its create price still passes, a coin that
    // already ran 100x does not.
    const vq = BigInt(curve.virtual_quote_reserves);
    const vt = BigInt(curve.virtual_token_reserves);
    if (launch.createVq > 0n && launch.createVt > 0n && vt > 0n) {
      const runup = (vq * launch.createVt * BPS) / (vt * launch.createVq);
      if (runup < BigInt(P.minRunupBps) || runup > BigInt(P.maxRunupBps)) return false;
    }
    return true;
  }

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      observe(batch);
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const txFee = state.txFeeLamports();
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));

      // 1. Clean up rides whose position is gone, and clear finished sells.
      for (const [mint, ride] of rides) {
        const pos = state.positions.get(mint);
        if (pos === undefined) {
          let inFlight = false;
          for (const po of state.pending.values()) {
            if (po.order.mint === mint) inFlight = true;
          }
          if (!inFlight) {
            rides.delete(mint);
            selling.delete(mint);
            const launch = launches.get(mint);
            if (launch !== undefined) launch.done = true;
          }
        }
      }

      // 2. Exits first: stop loss, trailing stop, creator sell, hold cap.
      for (const [mint, ride] of rides) {
        if (orders.length >= cap) break;
        if (ride.selling || selling.has(mint)) continue;
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined || curve === undefined || curve.complete) continue;
        const mark = marks.get(mint);
        const vq = mark !== undefined ? BigInt(mark.virtual_quote_reserves) : BigInt(curve.virtual_quote_reserves);
        const vt = mark !== undefined ? BigInt(mark.virtual_token_reserves) : BigInt(curve.virtual_token_reserves);
        const tokens = BigInt(pos.token_amount);
        const cost = BigInt(pos.cost_lamports);
        let value = sellValue(tokens, vq, vt);
        value = value > txFee ? value - txFee : 0n;
        if (value > ride.bestValue) ride.bestValue = value;
        const launch = launches.get(mint);
        const creatorSold = launch !== undefined && launch.creatorSold;
        let exit = false;
        if (value < (cost * BigInt(10_000 - P.stopLossBps)) / 10_000n) exit = true;
        if (!exit && ride.bestValue >= (cost * BigInt(10_000 + P.trailArmBps)) / 10_000n && value < (ride.bestValue * BigInt(10_000 - P.trailBps)) / 10_000n) exit = true;
        if (!exit && P.exitOnCreatorSell && creatorSold) exit = true;
        if (!exit && batch.slot - ride.openedSlot > P.maxHoldSlots) exit = true;
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        ride.selling = true;
        selling.add(mint);
      }

      // 3. Entries: one small buy per qualifying fresh launch.
      let free = state.freeCashLamports();
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      for (const [mint, launch] of launches) {
        if (orders.length >= cap || slotsLeft <= 0) break;
        if (rides.has(mint)) continue;
        let inFlight = false;
        for (const po of state.pending.values()) {
          if (po.order.mint === mint) inFlight = true;
        }
        if (inFlight) continue;
        const curve = state.curves.get(mint);
        if (!qualifies(launch, batch.slot, curve)) continue;
        const capLamports = state.maxBuyLamports(mint);
        let amount = BigInt(P.stakeLamports);
        if (amount > capLamports) amount = capLamports;
        if (amount < BigInt(P.minBuyLamports)) continue;
        // Keep enough cash to pay for this buy and its eventual sell.
        if (free < amount + txFee * 2n) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
        free -= amount + txFee;
        slotsLeft -= 1;
        rides.set(mint, { openedSlot: batch.slot, bestValue: 0n, selling: false });
        launch.done = true;
      }
      return orders;
    },
  };
}
