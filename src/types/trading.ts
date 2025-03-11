export interface TradingPlanValidation {
  isValid: boolean;
  status: 'WAIT' | 'SKIP';
  timeEstimate: string;
  reason: string;
  marketChanges: {
    priceAction: string;
    indicatorChanges: string;
    volumeProfile: string;
    patternStatus: string;
  };
  recommendedAction: string;
}

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

export interface SMCPattern {
  type: 'OrderBlock' | 'FairValueGap' | 'BreakerBlock' | 'Liquidity' | 'Imbalance' | 'Inducement';
  direction: 'bullish' | 'bearish';
  price: number;
  confidence: number;
  timeframe: string;
  timestamp: number;
}

export interface MarketStructure {
  trend: 'uptrend' | 'downtrend' | 'ranging';
  keyLevels: {
    price: number;
    type: 'support' | 'resistance' | 'breaker';
    strength: number;
  }[];
  swings: {
    price: number;
    type: 'HH' | 'LL' | 'HL' | 'LH';
    timestamp: number;
  }[];
}

export interface SMCAnalysis {
  patterns: SMCPattern[];
  marketStructure: MarketStructure;
  liquidityLevels: {
    price: number;
    type: 'buy' | 'sell';
    strength: number;
  }[];
  orderBlocks: {
    price: number;
    direction: 'bullish' | 'bearish';
    strength: number;
    active: boolean;
  }[];
  keyLevels: {
    price: number;
    type: 'support' | 'resistance' | 'breaker';
    strength: number;
  }[];
} 