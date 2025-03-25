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
  tradingPatterns: PatternType[];
  isAPlusSetup: boolean;
  aPlusReasons?: string[];
  marketContext: {
    trend: string;
    keyLevels: number[];
    liquidityLevels: LiquidityLevel[];
  };
}

export interface TradingData {
  symbol: string;
  interval: string;
  last100Candles: Candle[];
  indicators: Indicators;
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Indicators {
  rsi: number;
  ema20: number;
  ema50: number;
  ema200: number;
  adx: number;
  volumeProfile?: {
    valueArea: { high: number; low: number };
    poc: number;  // Point of Control
  };
}

export interface MarketMetrics {
  marketCap: number;
  dominance?: number;
  volume24h: number;
  priceChange24h: number;
}

export type PatternType = 'BOS' | 'ChoCH' | 'LiquidityGrab' | 'OrderBlock' | 'FairValueGap' | 'BreakerBlock' | 'Imbalance';
export type TradeDirection = 'long' | 'short';

export interface SMCPattern {
  type: PatternType;
  direction: 'bullish' | 'bearish';
  price: number;
  timestamp: number;
  timeframe: string;
  confidence: number;
  volume: number;
  averageVolume: number;
  priceAction: {
    cleanBreak: boolean;
    immediateRetrace: boolean;
    strongReversal: boolean;
  };
  validation: {
    volumeConfirmation: boolean;
    marketStructureAlignment: boolean;
    keyLevelProximity: boolean;
    multiTimeframeAlignment: boolean;
  };
}

export interface MarketStructure {
  trend: 'uptrend' | 'downtrend' | 'sideways';
  swings: {
    type: 'HH' | 'LL' | 'HL' | 'LH';
    price: number;
    timestamp: number;
    strength: number;
  }[];
  keyLevels: {
    price: number;
    type: 'support' | 'resistance' | 'breaker';
    strength: number;
    timeframe: string;
  }[];
}

export interface LiquidityLevel {
  price: number;
  type: 'buy' | 'sell';
  strength: number;
  volume: number;
  psychologicalLevel: boolean;
  stopCluster: boolean;
}

export interface SMCAnalysis {
  patterns: SMCPattern[];
  marketStructure: MarketStructure;
  liquidityLevels: LiquidityLevel[];
  orderBlocks: SMCPattern[];
  keyLevels: {
    price: number;
    type: 'support' | 'resistance' | 'breaker';
    strength: number;
  }[];
} 