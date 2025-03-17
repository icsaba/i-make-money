import { Interval, Spot } from '@binance/connector-typescript';
import { Candle, TradingPlan, SMCPattern, MarketStructure, SMCAnalysis, PatternType, TradeDirection } from '../types/trading';

// Binance kline response type based on their API documentation
type BinanceKline = [
  number,  // Kline open time
  string,  // Open price
  string,  // High price
  string,  // Low price
  string,  // Close price
  string,  // Volume
  number,  // Kline close time
  string,  // Quote asset volume
  number,  // Number of trades
  string,  // Taker buy base asset volume
  string,  // Taker buy quote asset volume
  string   // Unused field
];

// Cache interface to store data with timestamps
interface CacheEntry {
  data: Candle[];
  timestamp: number;
}

export class SMCTradingBot {
  private binanceService: Spot;
  // Cache structure: symbol -> interval -> CacheEntry
  private klineCache: Map<string, Map<string, CacheEntry>> = new Map();
  // Cache expiry times (in milliseconds)
  private cacheExpiryTimes: { [key: string]: number } = {
    '5m': 4 * 60 * 1000,     // 4 minutes for 5m data
    '15m': 12 * 60 * 1000,   // 12 minutes for 15m data
    '1h': 45 * 60 * 1000,    // 45 minutes for 1h data
    '4h': 3 * 60 * 60 * 1000 // 3 hours for 4h data
  };

  constructor(binanceService?: Spot) {
    if (binanceService) {
      this.binanceService = binanceService;
    } else {
      // Initialize with environment variables if not provided
      this.binanceService = new Spot(
        process.env.BINANCE_API_KEY!,
        process.env.BINANCE_API_SECRET!
      );
    }
  }

  private transformKlineToCandle(kline: BinanceKline): Candle {
    return {
      timestamp: kline[0],
      open: parseFloat(String(kline[1])),
      high: parseFloat(String(kline[2])),
      low: parseFloat(String(kline[3])),
      close: parseFloat(String(kline[4])),
      volume: parseFloat(String(kline[5]))
    };
  }

  /**
   * Get klines data with caching
   * @param symbol Trading pair symbol (e.g., BTCUSDT)
   * @param interval Time interval (e.g., 5m, 15m, 1h, 4h)
   * @param limit Number of candles to fetch
   * @param forceRefresh Whether to force a cache refresh
   * @returns Array of candles
   */
  private async getKlinesWithCache(
    symbol: string,
    interval: string,
    limit: number,
    forceRefresh: boolean = false
  ): Promise<Candle[]> {
    const now = Date.now();
    const intervalKey = interval;
    
    // Initialize cache for symbol if it doesn't exist
    if (!this.klineCache.has(symbol)) {
      this.klineCache.set(symbol, new Map());
    }
    
    const symbolCache = this.klineCache.get(symbol)!;
    const cacheEntry = symbolCache.get(intervalKey);
    const cacheExpiry = this.cacheExpiryTimes[intervalKey] || 5 * 60 * 1000; // Default to 5 minutes
    
    // Check if cache is valid
    const isCacheValid = cacheEntry && 
                         (now - cacheEntry.timestamp) < cacheExpiry && 
                         !forceRefresh;
    
    if (isCacheValid) {
      console.log(`Using cached ${intervalKey} data for ${symbol}`);
      return cacheEntry.data;
    }
    
    // Fetch new data if cache is invalid or missing
    console.log(`Fetching fresh ${intervalKey} data for ${symbol}`);
    try {
      const response = await this.binanceService.uiklines(symbol, Interval[intervalKey as keyof typeof Interval], { limit });
      const candles = (response as BinanceKline[]).map(k => this.transformKlineToCandle(k));
      
      // Update cache with new data
      symbolCache.set(intervalKey, {
        data: candles,
        timestamp: now
      });
      
      return candles;
    } catch (error) {
      console.error(`Error fetching ${intervalKey} data for ${symbol}:`, error);
      
      // If cache exists, return it even if expired
      if (cacheEntry) {
        console.log(`Using expired ${intervalKey} cache for ${symbol} due to fetch error`);
        return cacheEntry.data;
      }
      
      throw error;
    }
  }

  /**
   * Clear all cached data
   */
  public clearCache(): void {
    this.klineCache.clear();
    console.log('Kline cache cleared');
  }

  /**
   * Clear cached data for a specific symbol
   * @param symbol The trading pair symbol to clear cache for
   */
  public clearSymbolCache(symbol: string): void {
    this.klineCache.delete(symbol);
    console.log(`Cache cleared for ${symbol}`);
  }

  async analyzeSMC(symbol: string): Promise<TradingPlan | null> {
    try {
      // Get data from multiple timeframes with cache
      const data5m = await this.getKlinesWithCache(symbol, '5m', 100);
      const data15m = await this.getKlinesWithCache(symbol, '15m', 100);
      const data1h = await this.getKlinesWithCache(symbol, '1h', 100);
      const data4h = await this.getKlinesWithCache(symbol, '4h', 50);

      // Analyze market structure on higher timeframes
      const marketStructure = this.analyzeMarketStructure(data4h, data1h);
      
      // Find patterns on optimized timeframes
      const patterns = [
        ...this.findOrderBlocks(data15m, '15m'), // Order blocks on 15m
        ...this.findFairValueGaps(data5m, '5m'), // FVG on 5m for precision
        ...this.findChoCH(data4h, '4h'), // ChoCH on 4h for major structure
        ...this.findBOS(data1h, '1h'), // BOS on 1h for confirmation
        ...this.findLiquidityGrabs(data15m, '15m') // Liquidity grabs on 15m
      ];

      // Combine all analysis
      const analysis: SMCAnalysis = {
        patterns,
        marketStructure,
        liquidityLevels: this.findLiquidityLevels(data15m),
        orderBlocks: this.findOrderBlocks(data15m, '15m'),
        keyLevels: this.identifyKeyLevels(data4h)
      };

      return this.generateTradingPlan(analysis, data5m);
    } catch (error) {
      console.error('Error in analyzeSMC:', error);
      return null;
    }
  }

  private analyzeMarketStructure(data4h: Candle[], data1h: Candle[]): MarketStructure {
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

  private calculateGrabStrength(candle: Candle, avgVolume: number, avgRange: number): number {
    const volumeFactor = Math.min(candle.volume / avgVolume, 3) / 3;
    const rangeFactor = Math.min(Math.abs(candle.high - candle.low) / avgRange, 3) / 3;
    const wickFactor = Math.abs(candle.close - candle.open) / Math.abs(candle.high - candle.low);

    return Math.min(volumeFactor * 0.4 + rangeFactor * 0.3 + wickFactor * 0.3, 1);
  }

  private findLiquidityLevels(candles: Candle[]): { price: number; type: 'buy' | 'sell'; strength: number; }[] {
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

  private calculateAverageVolume(candles: Candle[]): number {
    return candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;
  }

  private calculateAverageRange(candles: Candle[]): number {
    return candles.reduce((sum, c) => sum + Math.abs(c.high - c.low), 0) / candles.length;
  }

  private mapDirectionToTradeDirection(direction: 'bullish' | 'bearish'): TradeDirection {
    return direction === 'bullish' ? 'long' : 'short';
  }

  private generateTradingPlan(analysis: SMCAnalysis, data5m: Candle[]): TradingPlan | null {
    // Find high confidence patterns
    const highConfidencePatterns = analysis.patterns.filter(p => p.confidence > 0.7);
    if (highConfidencePatterns.length === 0) return null;

    // Prioritize patterns by type and timeframe
    const patterns = this.prioritizePatterns(highConfidencePatterns);
    if (!patterns.length) return null;

    // Get the highest priority pattern
    const mainPattern = patterns[0];
    
    // Validate pattern alignment with market structure
    if (!this.validatePatternAlignment(mainPattern, analysis.marketStructure)) {
      return null;
    }

    // Calculate entry, stop loss and targets
    const setup = this.calculateTradeSetup(mainPattern, analysis, data5m);
    if (!setup) return null;

    return {
      direction: this.mapDirectionToTradeDirection(mainPattern.direction),
      entryPrice: setup.entry,
      stopLoss: setup.stopLoss,
      targets: setup.targets,
      confidenceScore: this.calculateConfidenceScore(patterns, analysis),
      timeframe: mainPattern.timeframe,
      positionSize: 1,
      maxLossPercentage: 1,
      riskRewardRatio: setup.riskRewardRatio,
      entryConditions: this.generateEntryConditions(patterns, analysis),
      exitConditions: this.generateExitConditions(setup),
      tradingPatterns: patterns.map(p => p.type)
    };
  }

  private prioritizePatterns(patterns: SMCPattern[]): SMCPattern[] {
    const patternPriority: Record<PatternType, number> = {
      'BOS': 5,
      'ChoCH': 4,
      'LiquidityGrab': 3,
      'OrderBlock': 2,
      'FairValueGap': 1
    };

    const timeframePriority: Record<string, number> = {
      '4h': 4,
      '1h': 3,
      '15m': 2,
      '5m': 1
    };

    return patterns.sort((a, b) => {
      // First by pattern priority
      const priorityDiff = patternPriority[b.type] - patternPriority[a.type];
      if (priorityDiff !== 0) return priorityDiff;
      
      // Then by timeframe
      const timeframeDiff = timeframePriority[b.timeframe] - timeframePriority[a.timeframe];
      if (timeframeDiff !== 0) return timeframeDiff;
      
      // Then by confidence
      const confidenceDiff = b.confidence - a.confidence;
      if (confidenceDiff !== 0) return confidenceDiff;
      
      // Finally by recency
      return b.timestamp - a.timestamp;
    });
  }

  private validatePatternAlignment(pattern: SMCPattern, structure: MarketStructure): boolean {
    // Higher timeframe patterns must align with market structure
    if (['BOS', 'ChoCH'].includes(pattern.type)) {
      if (pattern.direction === 'bullish' && structure.trend === 'downtrend') {
        return false;
      }
      if (pattern.direction === 'bearish' && structure.trend === 'uptrend') {
        return false;
      }
    }

    // Liquidity grabs should occur at significant levels
    if (pattern.type === 'LiquidityGrab') {
      const nearbyLevel = structure.keyLevels.find(level => 
        Math.abs(level.price - pattern.price) / pattern.price < 0.003
      );
      if (!nearbyLevel) return false;
    }

    return true;
  }

  private calculateTradeSetup(
    mainPattern: SMCPattern,
    analysis: SMCAnalysis,
    data5m: Candle[]
  ): { entry: number; stopLoss: number; targets: number[]; riskRewardRatio: number; } | null {
    const entry = mainPattern.price;
    
    // Get current price from the last 5min candle
    const currentPrice = data5m[data5m.length - 1].close;
    
    // Check if current price is within 0.25% of entry price
    const priceDiff = Math.abs(currentPrice - entry) / entry;
    if (priceDiff > 0.0025) { // 0.25% threshold
      console.log(`Trade setup rejected: Current price ${currentPrice} is too far from entry price ${entry} (${(priceDiff * 100).toFixed(2)}% difference)`);
      return null;
    }
    
    let stopLoss: number;
    
    // Find nearest swing for stop loss
    const relevantSwings = analysis.marketStructure.swings
      .filter(swing => mainPattern.direction === 'bullish' ? 
        swing.price < entry : swing.price > entry)
      .sort((a, b) => Math.abs(entry - a.price) - Math.abs(entry - b.price));

    if (!relevantSwings.length) return null;
    stopLoss = relevantSwings[0].price;

    // Find targets using key levels
    const targets = analysis.keyLevels
      .filter(level => mainPattern.direction === 'bullish' ? 
        level.price > entry : level.price < entry)
      .sort((a, b) => mainPattern.direction === 'bullish' ? 
        a.price - b.price : b.price - a.price)
      .slice(0, 3)
      .map(level => level.price);

    if (!targets.length) return null;

    const riskRewardRatio = Math.abs(targets[0] - entry) / Math.abs(stopLoss - entry);
    if (riskRewardRatio < 1.5) return null;

    return { entry, stopLoss, targets, riskRewardRatio };
  }

  private calculateConfidenceScore(patterns: SMCPattern[], analysis: SMCAnalysis): number {
    let score = patterns[0].confidence;

    // Boost confidence based on pattern confluence
    if (patterns.length > 1) {
      score += 0.1 * (patterns.length - 1);
    }

    // Boost confidence if market structure aligns
    if (patterns[0].direction === 'bullish' && analysis.marketStructure.trend === 'uptrend') {
      score += 0.1;
    } else if (patterns[0].direction === 'bearish' && analysis.marketStructure.trend === 'downtrend') {
      score += 0.1;
    }

    return Math.min(score, 1);
  }

  private generateEntryConditions(patterns: SMCPattern[], analysis: SMCAnalysis): string[] {
    const conditions = [
      `${patterns[0].type} pattern confirmed on ${patterns[0].timeframe}`,
      `Market structure: ${analysis.marketStructure.trend}`
    ];

    if (patterns.length > 1) {
      conditions.push(`Pattern confluence: ${patterns.map(p => p.type).join(', ')}`);
    }

    return conditions;
  }

  private generateExitConditions(setup: { stopLoss: number; targets: number[] }): string[] {
    return [
      `Stop loss at ${setup.stopLoss}`,
      ...setup.targets.map((target, i) => `Target ${i + 1} at ${target}`),
      'Pattern invalidation',
      'Market structure change'
    ];
  }

  private identifySwings(candles: Candle[]): { price: number; type: 'HH' | 'LL' | 'HL' | 'LH'; timestamp: number; }[] {
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

  private identifyKeyLevels(candles: Candle[]): { price: number; type: 'support' | 'resistance' | 'breaker'; strength: number; }[] {
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