import { TradingData, TradingPlan } from '../types/trading';

export class PromptFactory {
  static createAnalysisPrompt(data: TradingData): string {
    return `
      Analyze this trading data and provide a trading plan:
      Symbol: ${data.symbol}
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
    `;
  }

  static createValidationPrompt(plan: TradingPlan, currentData: TradingData): string {
    return `
      Previous trading plan: ${JSON.stringify(plan)}

      Current market conditions:
      Last 100 candles: ${JSON.stringify(currentData.last100Candles)}
      Technical Indicators:
      - RSI (14): ${currentData.indicators.rsi}
      - EMA20: ${currentData.indicators.ema20}
      - EMA50: ${currentData.indicators.ema50}
      - EMA200: ${currentData.indicators.ema200}
      - ADX (14): ${currentData.indicators.adx}
      - Recent Price: ${currentData.last100Candles[currentData.last100Candles.length - 1].close}

      Respond with a JSON object only:
      {
        "isValid": boolean,
        "reason": "string explaining why the plan is still valid or not"
      }
    `;
  }
} 