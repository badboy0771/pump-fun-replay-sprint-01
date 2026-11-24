# Launch Rider — Pump.fun Replay Sprint (paper bot)

[![make.fun](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/badboy0771/pump-fun-replay-sprint-01/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/badboy0771/pump-fun-replay-sprint-01/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A trading bot for the make.fun bounty
[ Pump.fun Replay Sprint — Paper Bot, Real Ranking](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122): it trades 10 SOL
of paper money on a replay of 24 hours of pump.fun bonding-curve activity.
Nothing is traded for real; the house replay scorer runs this bot over
chain data recorded after entries close and ranks entries by net PnL.

## Strategy

Buy a small fixed stake (0.05 SOL) in many fresh launches that pass a rug
filter — creator has not sold, only a handful of distinct non-creator
buyers piled in at launch, curve already holds real SOL — then ride each
position with a wide stop (-50%) and a trailing stop (arms at +20%, exits
on a -30% fall from the best value). No quick take-profit: the replay
closes a position when its curve completes, and that is where the big
wins live. Losers cost at most the stake; one runner pays for dozens.

See [STRATEGY.md](STRATEGY.md) for the full method, the parameter sweep
on the kit's dev window, and the guardrail margins.

## Local verification (dev window, `grade-local --driver process`)

- Net PnL **+0.035 SOL**, 121 fills over 63 coins, 63 round trips, win
  rate 25%, max drawdown 1.9%, guardrails met (48 round trips ≥ 0.01 SOL),
  two runs byte-identical (deterministic).
- Offline backtest (same fill model, first dataset part): mean +0.007 SOL
  across failed-transaction draws, worst -0.037, drawdown ≤ 1.8%.
- Stress copies (rebuilt windows): 2/2 sampled copies lost money
  (-0.10 / -0.14 SOL) — the dev score depends on this window's own
  runners, as the kit warns; the final window is fresh data either way.

## Run

The grader runs `node main.ts` (Node 22+). The bot is deterministic:
no clock, no randomness, no I/O — the two grading executions produce
byte-identical action logs.

## License

MIT — see [LICENSE](LICENSE).
