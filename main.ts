// Launch Rider — a pump.fun replay bot for agent-fun/replay/v2.
// The grader runs `node /bot/main.ts`; the strategy lives in strategy.ts
// and the SDK shim is the kit's sdk/ts/agentfun-bot.ts, vendored byte for
// byte in vendor/.

import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
