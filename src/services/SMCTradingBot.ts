import { Interval, Spot } from '@binance/connector-typescript';
import { Candle, TradingPlan, SMCPattern, MarketStructure, SMCAnalysis } from '../types/trading';

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
      
      // Find SMC patterns on lower timeframes
      const patterns5m = this.findSMCPatterns(data5m, '5m');
      const patterns15m = this.findSMCPatterns(data1h, '1h');

      // Combine all analysis
      const analysis: SMCAnalysis = {
        patterns: [...patterns5m, ...patterns15m],
        marketStructure,
        liquidityLevels: this.findLiquidityLevels(data15m),
        orderBlocks: this.findOrderBlocks(data15m),
        keyLevels: this.identifyKeyLevels(data4h)
      };

      return this.generateTradingPlan(analysis, symbol);
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

  private findSMCPatterns(candles: Candle[], timeframe: string): SMCPattern[] {
    const patterns: SMCPattern[] = [];

    // Look for order blocks
    for (let i = 1; i < candles.length - 1; i++) {
      const curr = candles[i];
      const prev = candles[i - 1];
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

      // Fair Value Gaps
      if (i > 0 && i < candles.length - 1) {
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
    }

    return patterns;
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

  private findOrderBlocks(candles: Candle[]): { price: number; direction: 'bullish' | 'bearish'; strength: number; active: boolean; }[] {
    const blocks: { price: number; direction: 'bullish' | 'bearish'; strength: number; active: boolean; }[] = [];

    for (let i = 1; i < candles.length - 1; i++) {
      const curr = candles[i];
      const next = candles[i + 1];

      // Bullish order block criteria
      if (curr.close < curr.open && next.close > next.open && next.close > curr.high) {
        blocks.push({
          price: (curr.high + curr.low) / 2,
          direction: 'bullish',
          strength: Math.abs(next.close - next.open) / next.open,
          active: true
        });
      }

      // Bearish order block criteria
      if (curr.close > curr.open && next.close < next.open && next.close < curr.low) {
        blocks.push({
          price: (curr.high + curr.low) / 2,
          direction: 'bearish',
          strength: Math.abs(next.close - next.open) / next.open,
          active: true
        });
      }
    }

    return blocks;
  }

  private generateTradingPlan(analysis: SMCAnalysis, symbol: string): TradingPlan | null {
    // Only generate plan if we have high confidence patterns
    const highConfidencePatterns = analysis.patterns.filter(p => p.confidence > 0.7);
    if (highConfidencePatterns.length === 0) return null;

    // Find the most recent high confidence pattern
    const latestPattern = highConfidencePatterns.reduce((latest, current) =>
      current.timestamp > latest.timestamp ? current : latest
    );

    // Only trade if pattern aligns with market structure
    if (latestPattern.direction === 'bullish' && analysis.marketStructure.trend === 'downtrend') return null;
    if (latestPattern.direction === 'bearish' && analysis.marketStructure.trend === 'uptrend') return null;

    // Calculate entry, stop loss and targets
    const currentPrice = latestPattern.price;
    const direction = latestPattern.direction === 'bullish' ? 'long' : 'short';

    // Define stop loss based on nearest key level in opposite direction
    const stopLoss = this.calculateStopLoss(currentPrice, direction, analysis);
    if (!stopLoss) return null;

    // Define targets based on next key levels
    const targets = this.calculateTargets(currentPrice, direction, analysis);
    if (targets.length === 0) return null;

    // Calculate risk-reward ratio
    const riskRewardRatio = Math.abs(targets[0] - currentPrice) / Math.abs(stopLoss - currentPrice);
    if (riskRewardRatio < 1.5) return null;

    return {
      direction,
      entryPrice: currentPrice,
      stopLoss,
      targets,
      confidenceScore: latestPattern.confidence,
      timeframe: latestPattern.timeframe,
      positionSize: 1, // This should be calculated based on risk management rules
      maxLossPercentage: 1, // 1% max loss per trade
      riskRewardRatio,
      entryConditions: [
        `Price reaches ${currentPrice}`,
        `${latestPattern.type} pattern confirmed`,
        `Market structure aligned (${analysis.marketStructure.trend})`
      ],
      exitConditions: [
        `Stop loss at ${stopLoss}`,
        'Pattern invalidation',
        'Target reached'
      ],
      tradingPatterns: [latestPattern.type]
    };
  }

  private calculateStopLoss(price: number, direction: string, analysis: SMCAnalysis): number | null {
    const relevantLevels = analysis.keyLevels
      .filter(level => direction === 'long' ? level.price < price : level.price > price)
      .sort((a, b) => Math.abs(price - a.price) - Math.abs(price - b.price));

    return relevantLevels[0]?.price || null;
  }

  private calculateTargets(price: number, direction: string, analysis: SMCAnalysis): number[] {
    const relevantLevels = analysis.keyLevels
      .filter(level => direction === 'long' ? level.price > price : level.price < price)
      .sort((a, b) => Math.abs(price - a.price) - Math.abs(price - b.price));

    return relevantLevels.slice(0, 3).map(level => level.price);
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