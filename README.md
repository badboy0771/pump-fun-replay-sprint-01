# Launch Rider — Pump.fun Replay Sprint (paper bot)

A trading bot for the make.fun bounty
`u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122`: it trades 10 SOL
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

## Run

The grader runs `node main.ts` (Node 22+). The bot is deterministic:
no clock, no randomness, no I/O — the two grading executions produce
byte-identical action logs.

## License

MIT — see [LICENSE](LICENSE).
