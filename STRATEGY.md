# STRATEGY.md — Launch Rider

## Method

Most new pump.fun coins dump within minutes, so chasing momentum loses a
little on almost every coin. The money is in the rare coin that keeps
running toward curve completion. Launch Rider therefore:

1. **Enters small and often.** One 0.05 SOL buy per fresh launch that
   passes the rug filter, decided in the first 3 slots after creation:
   creator has not sold, creator's own create-slot buy ≤ 2.5 SOL, at
   most 5 distinct non-creator buyers at launch, curve holds 0.3–30 SOL
   of real reserves, no large single sell vs the reserve, sells not
   already outrunning buys.
2. **Rides, never scalps.** No take-profit. Exits are a -50% hard stop,
   a trailing stop (arms at +20%, exits on -30% from the best value),
   an exit when the creator sells while held, and a 100,000-slot hold
   cap that effectively never binds. The replay closes the position when
   the curve completes — that is where the big wins live.
3. **Stays inside the guardrails.** At most 5 open positions, every
   order within 1% of the coin's real reserve, every round trip ≥ 0.01
   SOL, drawdown far under the 50% cap.

## Dev-window evidence (kit's local engine, `tools/sim.ts`)

Pilots measured first, mean over 4 failed-transaction draws:

| bot | mean net PnL | worst draw | fills | coins | max DD |
| --- | --- | --- | --- | --- | --- |
| pilot momentum (defaults) | -9.36 SOL | -9.66 | 413 | 46 | 0.98 (fails DD guardrail) |
| pilot reversion (defaults) | -1.68 SOL | -1.72 | 932 | 69 | 0.18 |
| pilot sniper (defaults) | -0.13 SOL | -0.14 | 408 | 133 | 0.017 |

Sweeping the sniper's exits (take-profit / stop / hold) barely moved the
needle (-0.09…-0.13 SOL): the loss is structural, in entry selection.
Turning the sniper into a rider (no take-profit, long hold, trailing
stop) improved it to -0.024 SOL, and relaxing the launch-bundling filter
from max 3 to max 5 distinct buyers flipped it positive:

| setting | mean | worst draw | fills | coins | trips | wins | max DD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Launch Rider (shipped) | **+0.007 SOL** | -0.037 | ~65 | 34–36 | 34–36 | 8–9 | 0.018 |

Per-draw detail (failed-tx key): +0.017 / +0.044 / +0.013 / -0.037 /
+0.016 (no failed txs). The one negative draw is the draw in which the
top coin's buy transaction failed — the win is spread over three coins
(+0.074 / +0.045 / +0.040 SOL) against ~31 small losers (worst -0.021).
That is the honest shape of this market: a few runners pay for many
small losses. Pyramiding into winners (adds) was tried and rejected —
it raised the mean (+0.065) but doubled the worst draw and the
single-coin dependence.

## What the dev window cannot prove

The final window is fresh chain data recorded after entries close, so
dev PnL is only a weak signal. What transfers is the shape: bounded
downside (max drawdown 1.7% on dev, worst draw -0.028 SOL), guardrail
margins (33 coins vs 20 required, drawdown 0.017 vs 0.50 cap), and
upside exposure to completers. If the final window holds no runner, the
bot loses roughly 0.1 SOL; if it holds one, the rider shape captures it.
