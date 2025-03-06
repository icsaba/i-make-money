import { MarketCondition } from './DatabaseService';
import { Candle, Indicators } from '../types/trading';

export interface MarketAnalysisResult {
  marketCondition: MarketCondition;
  keyLevels: {
    support: number[];
    resistance: number[];
  };
  riskManagement: {
    recommendedPositionSize: number;
    maxLossPercentage: number;
    riskRewardRatio: number;
  };
  volatilityMetrics: {
    averageTrueRange: number;
    volatilityIndex: number;
    priceSwings: number;
  };
}

export class MarketAnalysisService {
  private readonly PORTFOLIO_RISK_PERCENTAGE = 2; // 2% max risk per trade
  private readonly MAX_POSITION_SIZE = 5; // 5% max position size
  private readonly MIN_RISK_REWARD_RATIO = 2; // Minimum 1:2 risk/reward

  analyzeMarket(
    symbol: string,
    candles: Candle[],
    indicators: Indicators,
    marketCap?: number,
    dominance?: number
  ): MarketAnalysisResult {
    const trend = this.determineTrend(candles, indicators);
    const volatility = this.calculateVolatility(candles);
    const volume = this.analyzeVolume(candles);
    const keyLevels = this.findKeyLevels(candles);
    const riskManagement = this.calculateRiskParameters(candles[candles.length - 1].close, keyLevels);

    return {
      marketCondition: {
        trend: trend,
        volatility: volatility.level,
        volume: volume,
        marketCap: marketCap || 0,
        dominance: dominance
      },
      keyLevels: keyLevels,
      riskManagement: riskManagement,
      volatilityMetrics: {
        averageTrueRange: volatility.atr,
        volatilityIndex: volatility.index,
        priceSwings: volatility.swings
      }
    };
  }

  private determineTrend(candles: Candle[], indicators: Indicators): 'bullish' | 'bearish' | 'sideways' {
    const lastPrice = candles[candles.length - 1].close;
    const ema20 = indicators.ema20;
    const ema50 = indicators.ema50;
    const ema200 = indicators.ema200;
    const rsi = indicators.rsi;

    // Strong trend conditions
    if (lastPrice > ema20 && ema20 > ema50 && ema50 > ema200 && rsi > 50) {
      return 'bullish';
    }
    if (lastPrice < ema20 && ema20 < ema50 && ema50 < ema200 && rsi < 50) {
      return 'bearish';
    }

    // Check price movement range
    const priceRange = this.calculatePriceRange(candles, 20); // Last 20 candles
    const averagePrice = this.calculateAveragePrice(candles, 20);
    const rangePercentage = (priceRange / averagePrice) * 100;

    // If range is less than 3%, consider it sideways
    return rangePercentage < 3 ? 'sideways' : lastPrice > ema200 ? 'bullish' : 'bearish';
  }

  private calculateVolatility(candles: Candle[]): { 
    level: 'high' | 'medium' | 'low', 
    atr: number,
    index: number,
    swings: number 
  } {
    const atr = this.calculateATR(candles);
    const averagePrice = this.calculateAveragePrice(candles, candles.length);
    const volatilityIndex = (atr / averagePrice) * 100;
    const priceSwings = this.countPriceSwings(candles);

    let level: 'high' | 'medium' | 'low';
    if (volatilityIndex > 3) {
      level = 'high';
    } else if (volatilityIndex > 1.5) {
      level = 'medium';
    } else {
      level = 'low';
    }

    return {
      level,
      atr,
      index: volatilityIndex,
      swings: priceSwings
    };
  }

  private analyzeVolume(candles: Candle[]): 'high' | 'medium' | 'low' {
    const averageVolume = this.calculateAverageVolume(candles, 20);
    const recentVolume = this.calculateAverageVolume(candles.slice(-5), 5);
    
    const volumeRatio = recentVolume / averageVolume;
    
    if (volumeRatio > 1.5) return 'high';
    if (volumeRatio > 0.75) return 'medium';
    return 'low';
  }

  private findKeyLevels(candles: Candle[]): { support: number[], resistance: number[] } {
    const pivotPoints = this.findPivotPoints(candles);
    const clusters = this.clusterPriceLevels(pivotPoints);
    
    return {
      support: clusters.filter(level => level < candles[candles.length - 1].close),
      resistance: clusters.filter(level => level > candles[candles.length - 1].close)
    };
  }

  private calculateRiskParameters(currentPrice: number, keyLevels: { support: number[], resistance: number[] }) {
    const nearestSupport = Math.max(...keyLevels.support);
    const nearestResistance = Math.min(...keyLevels.resistance);
    
    const potentialLoss = currentPrice - nearestSupport;
    const potentialGain = nearestResistance - currentPrice;
    
    const riskRewardRatio = potentialGain / potentialLoss;
    
    // Calculate position size based on risk
    const maxLossAmount = this.PORTFOLIO_RISK_PERCENTAGE;
    const recommendedPositionSize = Math.min(
      (maxLossAmount * 100) / ((potentialLoss / currentPrice) * 100),
      this.MAX_POSITION_SIZE
    );

    return {
      recommendedPositionSize,
      maxLossPercentage: this.PORTFOLIO_RISK_PERCENTAGE,
      riskRewardRatio
    };
  }

  // Helper methods
  private calculateATR(candles: Candle[]): number {
    let sum = 0;
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      sum += tr;
    }
    return sum / candles.length;
  }

  private calculatePriceRange(candles: Candle[], period: number): number {
    const recentCandles = candles.slice(-period);
    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);
    return Math.max(...highs) - Math.min(...lows);
  }

  private calculateAveragePrice(candles: Candle[], period: number): number {
    const recentCandles = candles.slice(-period);
    const sum = recentCandles.reduce((acc, candle) => acc + candle.close, 0);
    return sum / period;
  }

  private calculateAverageVolume(candles: Candle[], period: number): number {
    const sum = candles.reduce((acc, candle) => acc + candle.volume, 0);
    return sum / period;
  }

  private countPriceSwings(candles: Candle[]): number {
    let swings = 0;
    let trending: 'up' | 'down' | null = null;

    for (let i = 1; i < candles.length; i++) {
      if (candles[i].close > candles[i - 1].close) {
        if (trending === 'down') swings++;
        trending = 'up';
      } else if (candles[i].close < candles[i - 1].close) {
        if (trending === 'up') swings++;
        trending = 'down';
      }
    }
    return swings;
  }

  private findPivotPoints(candles: Candle[]): number[] {
    const pivots: number[] = [];
    const lookback = 5;

    for (let i = lookback; i < candles.length - lookback; i++) {
      const currentHigh = candles[i].high;
      const currentLow = candles[i].low;
      
      let isHighPivot = true;
      let isLowPivot = true;

      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (candles[j].high > currentHigh) isHighPivot = false;
        if (candles[j].low < currentLow) isLowPivot = false;
      }

      if (isHighPivot) pivots.push(currentHigh);
      if (isLowPivot) pivots.push(currentLow);
    }

    return pivots;
  }

  private clusterPriceLevels(prices: number[]): number[] {
    const threshold = 0.001; // 0.1% threshold for clustering
    const clusters: number[] = [];
    
    prices.sort((a, b) => a - b);
    
    let currentCluster: number[] = [prices[0]];
    
    for (let i = 1; i < prices.length; i++) {
      const price = prices[i];
      const clusterAverage = currentCluster.reduce((a, b) => a + b) / currentCluster.length;
      
      if (Math.abs(price - clusterAverage) / clusterAverage <= threshold) {
        currentCluster.push(price);
      } else {
        clusters.push(clusterAverage);
        currentCluster = [price];
      }
    }
    
    if (currentCluster.length > 0) {
      clusters.push(currentCluster.reduce((a, b) => a + b) / currentCluster.length);
    }
    
    return clusters;
  }
} 