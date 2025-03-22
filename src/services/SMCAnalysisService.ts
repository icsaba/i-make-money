import { Candle, SMCPattern, MarketStructure, SMCAnalysis, PatternType } from '../types/trading';

export class SMCAnalysisService {
  /**
   * Analyze market structure using higher timeframe data
   */
  public analyzeMarketStructure(data4h: Candle[], data1h: Candle[]): MarketStructure {
    const structure: MarketStructure = {
      trend: 'ranging',
      keyLevels: [],
      swings: []
    };

    // Identify trend based on higher timeframe
    const last4hCandles = data4h.slice(-20);
    let highs = last4hCandles.map(c => c.high);
    let lows = last4hCandles.map(c => c.low);

    // Simple trend detection
    const isHigherHighs = highs.slice(-3).every((h, i, arr) => i === 0 || h > arr[i - 1]);
    const isHigherLows = lows.slice(-3).every((l, i, arr) => i === 0 || l > arr[i - 1]);
    const isLowerHighs = highs.slice(-3).every((h, i, arr) => i === 0 || h < arr[i - 1]);
    const isLowerLows = lows.slice(-3).every((l, i, arr) => i === 0 || l < arr[i - 1]);

    if (isHigherHighs && isHigherLows) structure.trend = 'uptrend';
    if (isLowerHighs && isLowerLows) structure.trend = 'downtrend';

    // Find key levels and swings
    const keyLevels = this.identifyKeyLevels(data4h);
    const swings = this.identifySwings(data1h);

    // Assign to structure
    structure.keyLevels = keyLevels;
    structure.swings = swings;

    return structure;
  }

  /**
   * Find patterns in the given timeframe
   */
  public findPatterns(candles: Candle[], timeframe: string, patternType: string): SMCPattern[] {
    // Only allow 5m and 15m timeframes
    if (timeframe !== '5m' && timeframe !== '15m') {
      return [];
    }

    // Get only recent candles (max 24 hours)
    const maxAge = timeframe === '15m' ? 96 : // 24 hours for 15m
      100; // ~8 hours for 5m

    const recentCandles = candles.slice(-maxAge);

    // Filter out patterns older than 24 hours
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const patterns = (() => {
      switch (patternType) {
        case 'OrderBlock':
          return this.findOrderBlocks(recentCandles, timeframe);
        case 'FairValueGap':
          return this.findFairValueGaps(recentCandles, timeframe);
        case 'ChoCH':
          return this.findChoCH(recentCandles, timeframe);
        case 'BOS':
          return this.findBOS(recentCandles, timeframe);
        case 'LiquidityGrab':
          return this.findLiquidityGrabs(recentCandles, timeframe);
        default:
          return [];
      }
    })();

    return patterns.filter(pattern => pattern.timestamp > oneDayAgo);
  }

  /**
   * Find order blocks in the candle data
   */
  private findOrderBlocks(candles: Candle[], timeframe: string): SMCPattern[] {
    const patterns: SMCPattern[] = [];

    for (let i = 1; i < candles.length - 1; i++) {
      const curr = candles[i];
      const next = candles[i + 1];

      // Bullish order block
      if (curr.close < curr.open && // bearish candle
        next.close > next.open && // bullish candle
        next.close > curr.high) { // strong momentum
        patterns.push({
          type: 'OrderBlock',
          direction: 'bullish',
          price: (curr.high + curr.low) / 2,
          confidence: 0.8,
          timeframe,
          timestamp: curr.timestamp
        });
      }

      // Bearish order block
      if (curr.close > curr.open && // bullish candle
        next.close < next.open && // bearish candle
        next.close < curr.low) { // strong momentum
        patterns.push({
          type: 'OrderBlock',
          direction: 'bearish',
          price: (curr.high + curr.low) / 2,
          confidence: 0.8,
          timeframe,
          timestamp: curr.timestamp
        });
      }
    }

    return patterns;
  }

  /**
   * Find fair value gaps in the candle data
   */
  private findFairValueGaps(candles: Candle[], timeframe: string): SMCPattern[] {
    const patterns: SMCPattern[] = [];

    for (let i = 1; i < candles.length - 1; i++) {
      // Bearish FVG
      if (candles[i - 1].low > candles[i + 1].high) {
        patterns.push({
          type: 'FairValueGap',
          direction: 'bearish',
          price: (candles[i - 1].low + candles[i + 1].high) / 2,
          confidence: 0.7,
          timeframe,
          timestamp: candles[i].timestamp
        });
      }
      // Bullish FVG
      if (candles[i - 1].high < candles[i + 1].low) {
        patterns.push({
          type: 'FairValueGap',
          direction: 'bullish',
          price: (candles[i - 1].high + candles[i + 1].low) / 2,
          confidence: 0.7,
          timeframe,
          timestamp: candles[i].timestamp
        });
      }
    }

    return patterns;
  }

  /**
   * Find change of character patterns
   */
  private findChoCH(candles: Candle[], timeframe: string): SMCPattern[] {
    const patterns: SMCPattern[] = [];
    const swings = this.identifySwings(candles);

    for (let i = 2; i < swings.length; i++) {
      const current = swings[i];
      const prev = swings[i - 1];
      const twoBefore = swings[i - 2];

      // Bullish CHoCH
      if (prev.type === 'LL' && current.type === 'HH' &&
        current.price > twoBefore.price) {
        patterns.push({
          type: 'ChoCH',
          direction: 'bullish',
          price: twoBefore.price,
          confidence: 0.85,
          timeframe,
          timestamp: current.timestamp
        });
      }

      // Bearish CHoCH
      if (prev.type === 'HH' && current.type === 'LL' &&
        current.price < twoBefore.price) {
        patterns.push({
          type: 'ChoCH',
          direction: 'bearish',
          price: twoBefore.price,
          confidence: 0.85,
          timeframe,
          timestamp: current.timestamp
        });
      }
    }

    return patterns;
  }

  /**
   * Find break of structure patterns
   */
  private findBOS(candles: Candle[], timeframe: string): SMCPattern[] {
    const patterns: SMCPattern[] = [];
    const swings = this.identifySwings(candles);

    for (let i = 3; i < swings.length; i++) {
      const current = swings[i];
      const prev1 = swings[i - 1];
      const prev2 = swings[i - 2];

      // Bullish BOS
      if (prev1.type === 'LH' && current.type === 'HH' &&
        current.price > prev2.price) {
        patterns.push({
          type: 'BOS',
          direction: 'bullish',
          price: prev2.price,
          confidence: 0.9,
          timeframe,
          timestamp: current.timestamp
        });
      }

      // Bearish BOS
      if (prev1.type === 'HL' && current.type === 'LL' &&
        current.price < prev2.price) {
        patterns.push({
          type: 'BOS',
          direction: 'bearish',
          price: prev2.price,
          confidence: 0.9,
          timeframe,
          timestamp: current.timestamp
        });
      }
    }

    return patterns;
  }

  /**
   * Find liquidity grab patterns
   */
  private findLiquidityGrabs(candles: Candle[], timeframe: string): SMCPattern[] {
    const patterns: SMCPattern[] = [];
    const avgVolume = this.calculateAverageVolume(candles);
    const avgRange = this.calculateAverageRange(candles);

    for (let i = 1; i < candles.length - 1; i++) {
      const curr = candles[i];
      const prev = candles[i - 1];

      // Buy-side liquidity grab
      if (curr.low < prev.low && // Sweeps the low
        curr.close > prev.low && // Closes above
        curr.volume > avgVolume * 1.5) { // High volume
        const strength = this.calculateGrabStrength(curr, avgVolume, avgRange);
        patterns.push({
          type: 'LiquidityGrab',
          direction: 'bullish',
          price: curr.low,
          confidence: strength,
          timeframe,
          timestamp: curr.timestamp
        });
      }

      // Sell-side liquidity grab
      if (curr.high > prev.high && // Sweeps the high
        curr.close < prev.high && // Closes below
        curr.volume > avgVolume * 1.5) { // High volume
        const strength = this.calculateGrabStrength(curr, avgVolume, avgRange);
        patterns.push({
          type: 'LiquidityGrab',
          direction: 'bearish',
          price: curr.high,
          confidence: strength,
          timeframe,
          timestamp: curr.timestamp
        });
      }
    }

    return patterns;
  }

  /**
   * Calculate the strength of a liquidity grab
   */
  private calculateGrabStrength(candle: Candle, avgVolume: number, avgRange: number): number {
    const volumeFactor = Math.min(candle.volume / avgVolume, 3) / 3;
    const rangeFactor = Math.min(Math.abs(candle.high - candle.low) / avgRange, 3) / 3;
    const wickFactor = Math.abs(candle.close - candle.open) / Math.abs(candle.high - candle.low);

    return Math.min(volumeFactor * 0.4 + rangeFactor * 0.3 + wickFactor * 0.3, 1);
  }

  /**
   * Find liquidity levels in the market
   */
  public findLiquidityLevels(candles: Candle[]): { price: number; type: 'buy' | 'sell'; strength: number; }[] {
    const levels: { price: number; type: 'buy' | 'sell'; strength: number; }[] = [];
    const swings = this.identifySwings(candles);

    // Look for clusters of swing lows/highs
    const swingLows = swings.filter(s => s.type === 'LL' || s.type === 'HL').map(s => s.price);
    const swingHighs = swings.filter(s => s.type === 'HH' || s.type === 'LH').map(s => s.price);

    // Group nearby levels
    const groupedLows = this.groupNearbyLevels(swingLows);
    const groupedHighs = this.groupNearbyLevels(swingHighs);

    // Convert to liquidity levels
    groupedLows.forEach(level => {
      levels.push({
        price: level.price,
        type: 'buy',
        strength: level.count / swingLows.length
      });
    });

    groupedHighs.forEach(level => {
      levels.push({
        price: level.price,
        type: 'sell',
        strength: level.count / swingHighs.length
      });
    });

    return levels;
  }

  /**
   * Calculate average volume from candles
   */
  private calculateAverageVolume(candles: Candle[]): number {
    return candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;
  }

  /**
   * Calculate average range from candles
   */
  private calculateAverageRange(candles: Candle[]): number {
    return candles.reduce((sum, c) => sum + Math.abs(c.high - c.low), 0) / candles.length;
  }

  /**
   * Calculate volatility from candles
   */
  public calculateVolatility(candles: Candle[]): number {
    const returns = [];
    for (let i = 1; i < candles.length; i++) {
      returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
    }

    // Calculate standard deviation of returns
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  /**
   * Identify swing points in the market
   */
  public identifySwings(candles: Candle[]): { price: number; type: 'HH' | 'LL' | 'HL' | 'LH'; timestamp: number; }[] {
    const swings: { price: number; type: 'HH' | 'LL' | 'HL' | 'LH'; timestamp: number; }[] = [];
    const lookback = 3; // Number of candles to look back/forward for swing confirmation

    // Previous swing values for comparison
    let lastSwingHigh = -Infinity;
    let lastSwingLow = Infinity;

    // Find swing points
    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i];
      const before = candles.slice(i - lookback, i);
      const after = candles.slice(i + 1, i + lookback + 1);

      // Check for swing high
      const isSwingHigh = before.every(c => c.high <= current.high) &&
        after.every(c => c.high <= current.high);

      // Check for swing low
      const isSwingLow = before.every(c => c.low >= current.low) &&
        after.every(c => c.low >= current.low);

      if (isSwingHigh) {
        // Determine if it's a higher high or lower high
        const type = current.high > lastSwingHigh ? 'HH' : 'LH';
        swings.push({
          price: current.high,
          type,
          timestamp: current.timestamp
        });
        lastSwingHigh = current.high;
      }

      if (isSwingLow) {
        // Determine if it's a lower low or higher low
        const type = current.low < lastSwingLow ? 'LL' : 'HL';
        swings.push({
          price: current.low,
          type,
          timestamp: current.timestamp
        });
        lastSwingLow = current.low;
      }
    }

    return swings;
  }

  /**
   * Identify key price levels
   */
  public identifyKeyLevels(candles: Candle[]): { price: number; type: 'support' | 'resistance' | 'breaker'; strength: number; }[] {
    const levels: { price: number; type: 'support' | 'resistance' | 'breaker'; strength: number; }[] = [];
    const swings = this.identifySwings(candles);
    const tolerance = 0.002; // 0.2% price difference to consider levels as the same

    // Group swing highs and lows
    const swingHighs = swings.filter(s => s.type === 'HH' || s.type === 'LH').map(s => s.price);
    const swingLows = swings.filter(s => s.type === 'LL' || s.type === 'HL').map(s => s.price);

    // Find clusters of swing points
    const highClusters = this.groupNearbyLevels(swingHighs);
    const lowClusters = this.groupNearbyLevels(swingLows);

    // Convert clusters to support/resistance levels
    highClusters.forEach(cluster => {
      // Check if this level was previously support (breaker)
      const wasSupport = lowClusters.some(low =>
        Math.abs(low.price - cluster.price) / cluster.price < tolerance
      );

      levels.push({
        price: cluster.price,
        type: wasSupport ? 'breaker' : 'resistance',
        strength: Math.min(cluster.count / swingHighs.length + 0.3, 1) // Normalize and boost strength
      });
    });

    lowClusters.forEach(cluster => {
      // Check if this level was previously resistance (breaker)
      const wasResistance = highClusters.some(high =>
        Math.abs(high.price - cluster.price) / cluster.price < tolerance
      );

      levels.push({
        price: cluster.price,
        type: wasResistance ? 'breaker' : 'support',
        strength: Math.min(cluster.count / swingLows.length + 0.3, 1) // Normalize and boost strength
      });
    });

    return levels;
  }

  /**
   * Group nearby price levels into clusters
   */
  private groupNearbyLevels(prices: number[]): { price: number; count: number; }[] {
    if (prices.length === 0) return [];

    const tolerance = 0.002; // 0.2% price difference to consider levels as the same
    const groups: { price: number; count: number; }[] = [];

    // Sort prices in ascending order
    const sortedPrices = [...prices].sort((a, b) => a - b);

    let currentGroup = {
      price: sortedPrices[0],
      prices: [sortedPrices[0]],
      count: 1
    };

    // Group nearby prices
    for (let i = 1; i < sortedPrices.length; i++) {
      const price = sortedPrices[i];
      const priceDiff = Math.abs(price - currentGroup.price) / currentGroup.price;

      if (priceDiff <= tolerance) {
        // Add to current group
        currentGroup.prices.push(price);
        currentGroup.count++;
      } else {
        // Finalize current group and start new one
        groups.push({
          price: currentGroup.prices.reduce((a, b) => a + b) / currentGroup.prices.length, // Average price
          count: currentGroup.count
        });
        currentGroup = {
          price,
          prices: [price],
          count: 1
        };
      }
    }

    // Add the last group
    groups.push({
      price: currentGroup.prices.reduce((a, b) => a + b) / currentGroup.prices.length,
      count: currentGroup.count
    });

    // Sort groups by count (strength) in descending order
    return groups.sort((a, b) => b.count - a.count);
  }
} 