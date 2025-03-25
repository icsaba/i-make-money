import { Candle, SMCPattern, MarketStructure, SMCAnalysis, PatternType, LiquidityLevel } from '../types/trading';

export class SMCAnalysisService {
  /**
   * Analyze market structure using higher timeframe data
   */
  public analyzeMarketStructure(candles: Candle[]): MarketStructure {
    const trend = this.identifyTrend(candles);
    const swings = this.identifySwings(candles).map(swing => ({
      ...swing,
      strength: this.calculateSwingStrength(swing.price, candles)
    }));
    const keyLevels = this.identifyKeyLevels(candles).map(level => ({
      ...level,
      timeframe: '4h' // Default to 4h for key levels
    }));

    return { trend, swings, keyLevels };
  }

  /**
   * Find patterns in the given timeframe
   */
  public findPatterns(candles: Candle[], timeframe: string, patternType: PatternType): SMCPattern[] {
    const patterns: SMCPattern[] = [];
    const timestamp = candles[candles.length - 1].timestamp;

    switch (patternType) {
      case 'OrderBlock':
        // Find bullish order blocks
        for (let i = 1; i < candles.length - 1; i++) {
          const [prev, curr, next] = [candles[i - 1], candles[i], candles[i + 1]];
          
          if (curr.close < curr.open && next.close > next.open && next.close > curr.high) {
            patterns.push(this.createPattern(
              'OrderBlock',
              'bullish',
              curr.low,
              0.8,
              timeframe,
              timestamp,
              candles
            ));
          }
          
          if (curr.close > curr.open && next.close < next.open && next.close < curr.low) {
            patterns.push(this.createPattern(
              'OrderBlock',
              'bearish',
              curr.high,
              0.8,
              timeframe,
              timestamp,
              candles
            ));
          }
        }
        break;

      case 'FairValueGap':
        // Find fair value gaps
        for (let i = 1; i < candles.length - 1; i++) {
          const [prev, curr, next] = [candles[i - 1], candles[i], candles[i + 1]];
          
          // Bearish FVG
          if (curr.low > next.high) {
            patterns.push(this.createPattern(
              'FairValueGap',
              'bearish',
              (curr.low + next.high) / 2,
              0.7,
              timeframe,
              timestamp,
              candles
            ));
          }
          
          // Bullish FVG
          if (curr.high < next.low) {
            patterns.push(this.createPattern(
              'FairValueGap',
              'bullish',
              (curr.high + next.low) / 2,
              0.7,
              timeframe,
              timestamp,
              candles
            ));
          }
        }
        break;

      case 'ChoCH':
        // Find change of character patterns
        const swings = this.identifySwings(candles);
        for (let i = 2; i < swings.length; i++) {
          const [swing1, swing2, swing3] = [swings[i - 2], swings[i - 1], swings[i]];
          
          // Bullish CHoCH: LL followed by HH
          if (swing1.type === 'LL' && swing3.type === 'HH') {
            patterns.push(this.createPattern(
              'ChoCH',
              'bullish',
              swing3.price,
              0.9,
              timeframe,
              timestamp,
              candles
            ));
          }
          
          // Bearish CHoCH: HH followed by LL
          if (swing1.type === 'HH' && swing3.type === 'LL') {
            patterns.push(this.createPattern(
              'ChoCH',
              'bearish',
              swing3.price,
              0.9,
              timeframe,
              timestamp,
              candles
            ));
          }
        }
        break;

      case 'BOS':
        // Find break of structure patterns
        const bosSwings = this.identifySwings(candles);
        for (let i = 1; i < bosSwings.length; i++) {
          const [prev, curr] = [bosSwings[i - 1], bosSwings[i]];
          
          // Bullish BOS: Break above LH
          if (prev.type === 'LH' && curr.price > prev.price) {
            patterns.push(this.createPattern(
              'BOS',
              'bullish',
              curr.price,
              0.85,
              timeframe,
              timestamp,
              candles
            ));
          }
          
          // Bearish BOS: Break below HL
          if (prev.type === 'HL' && curr.price < prev.price) {
            patterns.push(this.createPattern(
              'BOS',
              'bearish',
              curr.price,
              0.85,
              timeframe,
              timestamp,
              candles
            ));
          }
        }
        break;

      case 'LiquidityGrab':
        // Find liquidity grab patterns
        for (let i = 2; i < candles.length; i++) {
          const [c1, c2, c3] = [candles[i - 2], candles[i - 1], candles[i]];
          
          // Bullish liquidity grab (sweep lows)
          if (c2.low < c1.low && c3.close > c2.high) {
            patterns.push(this.createPattern(
              'LiquidityGrab',
              'bullish',
              c2.low,
              0.75,
              timeframe,
              timestamp,
              candles
            ));
          }
          
          // Bearish liquidity grab (sweep highs)
          if (c2.high > c1.high && c3.close < c2.low) {
            patterns.push(this.createPattern(
              'LiquidityGrab',
              'bearish',
              c2.high,
              0.75,
              timeframe,
              timestamp,
              candles
            ));
          }
        }
        break;

      case 'BreakerBlock':
        // Find breaker blocks (former support/resistance that's been broken)
        const levels = this.identifyKeyLevels(candles);
        const lastPrice = candles[candles.length - 1].close;
        
        levels.forEach(level => {
          if (level.type === 'support' && lastPrice < level.price) {
            patterns.push(this.createPattern(
              'BreakerBlock',
              'bearish',
              level.price,
              0.8,
              timeframe,
              timestamp,
              candles
            ));
          }
          if (level.type === 'resistance' && lastPrice > level.price) {
            patterns.push(this.createPattern(
              'BreakerBlock',
              'bullish',
              level.price,
              0.8,
              timeframe,
              timestamp,
              candles
            ));
          }
        });
        break;

      case 'Imbalance':
        // Find imbalances (rapid price movements with unfilled gaps)
        for (let i = 1; i < candles.length - 1; i++) {
          const [prev, curr, next] = [candles[i - 1], candles[i], candles[i + 1]];
          
          // Bullish imbalance
          if (curr.close > prev.high * 1.005 && next.low > curr.high) {
            patterns.push(this.createPattern(
              'Imbalance',
              'bullish',
              curr.close,
              0.7,
              timeframe,
              timestamp,
              candles
            ));
          }
          
          // Bearish imbalance
          if (curr.close < prev.low * 0.995 && next.high < curr.low) {
            patterns.push(this.createPattern(
              'Imbalance',
              'bearish',
              curr.close,
              0.7,
              timeframe,
              timestamp,
              candles
            ));
          }
        }
        break;
    }

    return patterns;
  }

  /**
   * Find liquidity levels in the market
   */
  public findLiquidityLevels(candles: Candle[]): LiquidityLevel[] {
    const levels: LiquidityLevel[] = [];
    const avgVolume = this.calculateAverageVolume(candles);

    for (let i = 1; i < candles.length - 1; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];
      const next = candles[i + 1];

      // Check for potential liquidity level
      if (curr.volume > avgVolume * 1.5) {
        // Buy-side liquidity (price sweeps below support)
        if (curr.low < prev.low && curr.close > prev.low) {
          levels.push({
            price: curr.low,
            type: 'buy',
            strength: curr.volume / avgVolume,
            volume: curr.volume,
            psychologicalLevel: this.isPsychologicalLevel(curr.low),
            stopCluster: this.hasStopCluster(candles, curr.low, 'buy')
          });
        }
        // Sell-side liquidity (price sweeps above resistance)
        if (curr.high > prev.high && curr.close < prev.high) {
          levels.push({
            price: curr.high,
            type: 'sell',
            strength: curr.volume / avgVolume,
            volume: curr.volume,
            psychologicalLevel: this.isPsychologicalLevel(curr.high),
            stopCluster: this.hasStopCluster(candles, curr.high, 'sell')
          });
        }
      }
    }

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
  public identifyKeyLevels(candles: Candle[]): { price: number; type: 'support' | 'resistance' | 'breaker'; strength: number; timeframe: string; }[] {
    const levels: { price: number; type: 'support' | 'resistance' | 'breaker'; strength: number; timeframe: string; }[] = [];
    const priceMap = new Map<number, { count: number; type: 'support' | 'resistance' | 'breaker' }>();

    // Round prices to reasonable precision to group similar levels
    const roundPrice = (price: number) => Math.round(price * 10000) / 10000;

    // Analyze each candle for potential levels
    candles.forEach((candle, i) => {
      if (i === 0 || i === candles.length - 1) return;

      const prev = candles[i - 1];
      const next = candles[i + 1];

      // Support level
      if (candle.low < prev.low && candle.low < next.low) {
        const price = roundPrice(candle.low);
        const existing = priceMap.get(price);
        if (existing) {
          existing.count++;
        } else {
          priceMap.set(price, { count: 1, type: 'support' });
        }
      }

      // Resistance level
      if (candle.high > prev.high && candle.high > next.high) {
        const price = roundPrice(candle.high);
        const existing = priceMap.get(price);
        if (existing) {
          existing.count++;
        } else {
          priceMap.set(price, { count: 1, type: 'resistance' });
        }
      }

      // Breaker level (former support/resistance that's been broken)
      if (i > 1 && i < candles.length - 2) {
        const prevSupport = candle.low < prev.low && candle.low < candles[i - 2].low;
        const nextBreak = next.close < candle.low && candles[i + 2].close < candle.low;
        if (prevSupport && nextBreak) {
          const price = roundPrice(candle.low);
          priceMap.set(price, { count: 2, type: 'breaker' });
        }

        const prevResistance = candle.high > prev.high && candle.high > candles[i - 2].high;
        const nextBreakUp = next.close > candle.high && candles[i + 2].close > candle.high;
        if (prevResistance && nextBreakUp) {
          const price = roundPrice(candle.high);
          priceMap.set(price, { count: 2, type: 'breaker' });
        }
      }
    });

    // Convert map to array and calculate strength
    const maxCount = Math.max(...Array.from(priceMap.values()).map(v => v.count));
    priceMap.forEach((value, price) => {
      levels.push({
        price,
        type: value.type,
        strength: value.count / maxCount,
        timeframe: this.determineTimeframe(candles)
      });
    });

    return levels.sort((a, b) => b.strength - a.strength);
  }

  private determineTimeframe(candles: Candle[]): string {
    if (candles.length < 2) return '5m';
    const timeDiff = candles[1].timestamp - candles[0].timestamp;
    
    // Convert milliseconds to minutes
    const minutes = timeDiff / (60 * 1000);
    
    if (minutes <= 5) return '5m';
    if (minutes <= 15) return '15m';
    if (minutes <= 60) return '1h';
    return '4h';
  }

  private isPsychologicalLevel(price: number): boolean {
    // Check if price is near a round number
    const roundedPrice = Math.round(price);
    return Math.abs(price - roundedPrice) < 0.001 && 
           (roundedPrice % 100 === 0 || roundedPrice % 1000 === 0);
  }

  private hasStopCluster(candles: Candle[], price: number, type: 'buy' | 'sell'): boolean {
    // Count how many recent candles have wicks near this price level
    const threshold = price * 0.001; // 0.1% threshold
    const recentCandles = candles.slice(-20); // Look at last 20 candles
    let wickCount = 0;

    recentCandles.forEach(candle => {
      if (type === 'buy' && Math.abs(candle.low - price) < threshold) wickCount++;
      if (type === 'sell' && Math.abs(candle.high - price) < threshold) wickCount++;
    });

    return wickCount >= 3; // Consider it a cluster if 3 or more wicks touch the level
  }

  private createPattern(
    type: PatternType,
    direction: 'bullish' | 'bearish',
    price: number,
    confidence: number,
    timeframe: string,
    timestamp: number,
    candles: Candle[]
  ): SMCPattern {
    const avgVolume = this.calculateAverageVolume(candles);
    const currentVolume = candles[candles.length - 1].volume;

    return {
      type,
      direction,
      price,
      confidence,
      timeframe,
      timestamp,
      volume: currentVolume,
      averageVolume: avgVolume,
      priceAction: {
        cleanBreak: this.hasCleanBreak(candles),
        immediateRetrace: this.hasImmediateRetrace(candles),
        strongReversal: this.hasStrongReversal(candles)
      },
      validation: {
        volumeConfirmation: currentVolume > avgVolume * 1.5,
        marketStructureAlignment: this.isAlignedWithMarketStructure(candles, direction),
        keyLevelProximity: this.isNearKeyLevel(price, this.identifyKeyLevels(candles)),
        multiTimeframeAlignment: true // This should be checked at a higher level
      }
    };
  }

  private hasCleanBreak(candles: Candle[]): boolean {
    // Check last 3 candles for clean break
    const last3 = candles.slice(-3);
    if (last3.length < 3) return false;

    const [c1, c2, c3] = last3;
    return Math.abs(c3.close - c3.open) > Math.abs(c2.close - c2.open) * 1.2;
  }

  private hasImmediateRetrace(candles: Candle[]): boolean {
    // Check if price immediately retraced after the break
    const last3 = candles.slice(-3);
    if (last3.length < 3) return false;

    const [c1, c2, c3] = last3;
    return (c3.close - c3.open) * (c2.close - c2.open) < 0;
  }

  private hasStrongReversal(candles: Candle[]): boolean {
    // Check for strong reversal candlestick pattern
    const last2 = candles.slice(-2);
    if (last2.length < 2) return false;

    const [c1, c2] = last2;
    return Math.abs(c2.close - c2.open) > Math.abs(c1.high - c1.low) * 1.5;
  }

  private isAlignedWithMarketStructure(candles: Candle[], direction: 'bullish' | 'bearish'): boolean {
    const trend = this.identifyTrend(candles);
    return (direction === 'bullish' && trend === 'uptrend') ||
           (direction === 'bearish' && trend === 'downtrend');
  }

  private isNearKeyLevel(price: number, keyLevels: { price: number; type: string; strength: number; timeframe: string; }[]): boolean {
    return keyLevels.some(level => 
      Math.abs(level.price - price) / price < 0.003 && level.strength >= 0.7
    );
  }

  private identifyTrend(candles: Candle[]): 'uptrend' | 'downtrend' | 'sideways' {
    const closes = candles.map(c => c.close);
    const sma20 = this.calculateSMA(closes, 20);
    const sma50 = this.calculateSMA(closes, 50);

    if (sma20 > sma50 * 1.02) return 'uptrend';
    if (sma20 < sma50 * 0.98) return 'downtrend';
    return 'sideways';
  }

  private calculateSMA(values: number[], period: number): number {
    if (values.length < period) return values[values.length - 1];
    const sum = values.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
  }

  private calculateSwingStrength(price: number, candles: Candle[]): number {
    // Calculate swing strength based on volume and retests
    const nearbyCandles = candles.filter(c => 
      Math.abs(c.high - price) / price < 0.005 ||
      Math.abs(c.low - price) / price < 0.005
    );

    const volumeStrength = nearbyCandles.reduce((sum, c) => sum + c.volume, 0) /
                          (candles.reduce((sum, c) => sum + c.volume, 0) / candles.length);

    const retestCount = nearbyCandles.length;
    const maxRetests = 5; // Cap the number of retests considered

    return Math.min((volumeStrength * 0.6 + (retestCount / maxRetests) * 0.4), 1);
  }
} 