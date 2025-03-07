import { TradingData, TradingPlan } from '../types/trading';

export class PromptFactory {
  static createAnalysisPrompt(data: TradingData): string {
    return `
      Analyze this trading data and provide a trading plan:
      Symbol: ${data.symbol}
      Timeframe/Interval: ${data.interval}
      Last 100 candles from Binance: ${JSON.stringify(data.last100Candles)}
      Technical Indicators:
      - RSI (14): ${data.indicators.rsi}
      - EMA20: ${data.indicators.ema20}
      - EMA50: ${data.indicators.ema50}
      - EMA200: ${data.indicators.ema200}
      - ADX (14): ${data.indicators.adx}
      - Recent Price: ${data.last100Candles[data.last100Candles.length - 1].close}

      Provide your analysis in the following JSON format only, no other text:
      {
        "marketAnalysis": {
          "trend": "bullish|bearish|sideways",
          "volatility": "high|medium|low",
          "volume": "high|medium|low",
          "marketCap": number,
          "dominance": number,
          "keyLevels": {
            "support": [numbers],
            "resistance": [numbers]
          },
          "marketSentiment": "string"
        },
        "tradingPlan": {
          "direction": "long|short",
          "entryPrice": number,
          "stopLoss": number,
          "targets": [numbers],
          "confidenceScore": number,
          "timeframe": "string",
          "positionSize": number,
          "maxLossPercentage": number,
          "riskRewardRatio": number,
          "entryConditions": ["strings"],
          "exitConditions": ["strings"],
          "tradingPatterns": ["strings"]
        }
      }

      Rules:
      1. Provide high confidence trades only (>70)
      2. If no clear setup, set confidence to 0
      3. Include multiple entry/stop/target levels if applicable
      4. Be specific with confirmation conditions (include price levels and indicator values)
      5. Risk management:
         - Position size should not exceed 5% of portfolio
         - Maximum loss should not exceed 2% of portfolio
         - Minimum risk-reward ratio of 1:2
      6. Market analysis should consider:
         - Overall market trend and structure
         - Volume profile and analysis
         - Market cycles and momentum
         - Correlation with major indices/BTC
         - Support/resistance levels
         - Chart patterns and price action
      7. Entry conditions must include:
         - Price action confirmation
         - Volume confirmation
         - Indicator alignment
         - Pattern completion
      8. Exit conditions must specify:
         - Profit targets with specific levels
         - Stop loss with reasoning
         - Trailing stop parameters
         - Pattern invalidation levels
      9. The timeframe in the trading plan MUST match the interval of the analyzed data (${data.interval})
    `;
  }

  static createValidationPrompt(plan: TradingPlan, currentData: TradingData): string {
    return `
      Analyze if this trading plan is still valid under current market conditions.
      
      Previous trading plan: ${JSON.stringify(plan)}

      Current market conditions:
      Symbol: ${currentData.symbol}
      Timeframe/Interval: ${currentData.interval}
      Last 100 candles: ${JSON.stringify(currentData.last100Candles)}
      Technical Indicators:
      - RSI (14): ${currentData.indicators.rsi}
      - EMA20: ${currentData.indicators.ema20}
      - EMA50: ${currentData.indicators.ema50}
      - EMA200: ${currentData.indicators.ema200}
      - ADX (14): ${currentData.indicators.adx}
      - Recent Price: ${currentData.last100Candles[currentData.last100Candles.length - 1].close}

      Rules for validation:
      1. Compare current price levels with planned entry points
      2. Check if technical indicators still support the trade
      3. Verify if key support/resistance levels are still relevant
      4. Analyze if market structure matches the original plan
      5. Evaluate if risk/reward ratio is still favorable
      6. Consider market momentum and volume
      7. Check if pattern or setup is still forming/valid

      Respond with a JSON object only:
      {
        "isValid": boolean,
        "status": "WAIT" | "SKIP",
        "timeEstimate": "string describing how long to wait if status is WAIT (e.g., '2-3 hours', '30-45 minutes')",
        "reason": "detailed explanation of why the plan is still valid/invalid and what changed in market conditions",
        "marketChanges": {
          "priceAction": "describe price movement relative to plan",
          "indicatorChanges": "describe how indicators evolved",
          "volumeProfile": "describe volume changes",
          "patternStatus": "describe if patterns completed/failed"
        },
        "recommendedAction": "specific action to take (wait with timeframe, skip with reason, or modify with suggestions)"
      }

      Notes:
      - If the plan is still valid but needs time, set isValid=true, status="WAIT" and provide timeEstimate
      - If the opportunity has passed or setup invalidated, set isValid=false, status="SKIP"
      - Be specific about timeframes in timeEstimate
      - Provide detailed reasoning for market changes
      - Consider the original timeframe (${currentData.interval}) when estimating waiting time
    `;
  }
} 