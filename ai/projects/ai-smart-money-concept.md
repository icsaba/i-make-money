# Step 1

let's have a new trading bot, name it SMCTadingBot, that applies smart money concept on 5M or 15M charts mainly and returns a trading plan that can be played out within the next 2 candles. If there's nothing to do, do not provide a plan. 

# Step 2

Add a new promt to the @PromtFactory.ts and generate types on demand as well in the @trading.ts file. Output should be the same we already have.

# Step 3

Keep the current logic, if there's a need do a refactor instead. 
You can request multiple timeframe data from binance on demand.

# Step 4

Let's define Smart Money Concept:

Smart Money Concept (SMC) is a trading methodology based on understanding and tracking the behavior of institutional traders or "smart money" - the large financial institutions, banks, hedge funds, and professional traders who move markets with their significant capital.
Here are the key principles of SMC:

Order Blocks: Areas where institutional traders place large buy or sell orders. These appear as strong candles in one direction followed by a move in the opposite direction.
Liquidity: Smart money looks to buy where retail traders place stop losses below support, and sell where retail traders place stop losses above resistance. This is called "liquidity hunting."
Market Structure: SMC traders identify shifts in market structure through Higher Highs/Lower Lows (HH/LL) and Higher Lows/Lower Highs (HL/LH) to determine overall trend direction.
Fair Value Gaps (FVGs): Imbalances in price where candles don't overlap, indicating aggressive buying or selling by institutional traders.
Breaker Blocks: Former support zones that become resistance or former resistance zones that become support.
Imbalances: Areas where price moves rapidly, showing an imbalance between buyers and sellers, often indicative of smart money accumulation or distribution.
Inducement: Price moves designed to trigger retail traders' stop losses or entice them into bad positions before reversing.

In practical application, SMC traders look for these institutional footprints on charts, focusing on higher timeframes first (daily, 4H) then drilling down to lower timeframes to find precise entries. The goal is to align with institutional money flow rather than fighting against it.
For trading pairs, applying SMC would involve identifying key order blocks on higher timeframes, watching for liquidity sweeps around significant levels, and entering trades only when price action suggests institutional traders are positioning in a particular direction.