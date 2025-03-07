export interface TradingPlan {
  direction: 'long' | 'short';
  entryPrice: number;
  stopLoss: number;
  targets: number[];
  confidenceScore: number;
  timeframe: string;
  positionSize: number;
  maxLossPercentage: number;
  riskRewardRatio: number;
  entryConditions: string[];
  exitConditions: string[];
  tradingPatterns: string[];
}

export interface TradingData {
  symbol: string;
  interval: string;
  last100Candles: Candle[];
  indicators: Indicators;
}

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface Indicators {
  rsi: number;
  ema20: number;
  ema50: number;
  ema200: number;
  adx: number;
}

export interface MarketMetrics {
  marketCap: number;
  dominance?: number;
  volume24h: number;
  priceChange24h: number;
} 