import { Interval, Spot } from '@binance/connector-typescript';
import { Candle, TradingPlan, SMCPattern, MarketStructure, SMCAnalysis, PatternType, TradeDirection } from '../types/trading';
import { SMCAnalysisService } from '../services/SMCAnalysisService';
import { TradeQueueManager, QueuedTradeSetup } from '../services/TradeQueueManager';

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
  private analysisService: SMCAnalysisService;
  private queueManager: TradeQueueManager;
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
    this.analysisService = new SMCAnalysisService();
    this.queueManager = new TradeQueueManager();
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
      console.log(`\x1b[36m🔍 Analyzing ${symbol} for SMC patterns...\x1b[0m`);
      
      // Get data from multiple timeframes with cache
      const data5m = await this.getKlinesWithCache(symbol, '5m', 100);
      const data15m = await this.getKlinesWithCache(symbol, '15m', 100);
      const data1h = await this.getKlinesWithCache(symbol, '1h', 100);
      const data4h = await this.getKlinesWithCache(symbol, '4h', 50);

      // Check queued setups first
      const currentPrice = data5m[data5m.length - 1].close;
      const validQueuedSetups = this.queueManager.checkQueuedSetups(symbol, currentPrice);
      
      if (validQueuedSetups.length > 0) {
        console.log(`\x1b[32m🎯 Found ${validQueuedSetups.length} valid queued setup(s)\x1b[0m`);
        // Process the first valid queued setup
        const setup = validQueuedSetups[0];
        return this.generateTradingPlan(setup.analysis, data5m, symbol);
      }

      // Analyze market structure on higher timeframes for context only
      const marketStructure = this.analysisService.analyzeMarketStructure(data4h, data1h);
      
      // Find patterns ONLY on 5m and 15m timeframes
      const patterns = [
        ...this.analysisService.findPatterns(data15m, '15m', 'OrderBlock'),
        ...this.analysisService.findPatterns(data5m, '5m', 'OrderBlock'),
        ...this.analysisService.findPatterns(data15m, '15m', 'FairValueGap'),
        ...this.analysisService.findPatterns(data5m, '5m', 'FairValueGap'),
        ...this.analysisService.findPatterns(data15m, '15m', 'LiquidityGrab'),
        ...this.analysisService.findPatterns(data5m, '5m', 'LiquidityGrab'),
        ...this.analysisService.findPatterns(data15m, '15m', 'BOS'),
        ...this.analysisService.findPatterns(data5m, '5m', 'BOS'),
        ...this.analysisService.findPatterns(data15m, '15m', 'ChoCH'),
        ...this.analysisService.findPatterns(data5m, '5m', 'ChoCH')
      ];

      // Filter out patterns older than 24 hours
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const recentPatterns = patterns.filter(pattern => pattern.timestamp > oneDayAgo);

      if (recentPatterns.length === 0) {
        console.log('\x1b[33m⚠️ No recent patterns found in lower timeframes\x1b[0m');
        return null;
      }

      // Combine all analysis
      const analysis: SMCAnalysis = {
        patterns: recentPatterns,
        marketStructure,
        liquidityLevels: this.analysisService.findLiquidityLevels(data15m),
        orderBlocks: this.analysisService.findPatterns(data15m, '15m', 'OrderBlock'),
        keyLevels: this.analysisService.identifyKeyLevels(data4h)
      };

      return this.generateTradingPlan(analysis, data5m, symbol);
    } catch (error) {
      console.error('\x1b[31m❌ Error in analyzeSMC:', error, '\x1b[0m');
      return null;
    }
  }

  private mapDirectionToTradeDirection(direction: 'bullish' | 'bearish'): TradeDirection {
    return direction === 'bullish' ? 'long' : 'short';
  }

  private generateTradingPlan(analysis: SMCAnalysis, data5m: Candle[], symbol: string): TradingPlan | null {
    // Find high confidence patterns
    const highConfidencePatterns = analysis.patterns.filter(p => p.confidence > 0.7);
    if (highConfidencePatterns.length === 0) {
      console.log('\x1b[33m⚠️ No high confidence patterns found\x1b[0m');
      return null;
    }

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
    const setup = this.calculateTradeSetup(mainPattern, analysis, data5m, symbol);
    if (!setup) return null;

    // Calculate confidence score and check for A+ setup
    const confidenceScore = this.calculateConfidenceScore(patterns, analysis);
    
    return {
      direction: this.mapDirectionToTradeDirection(mainPattern.direction),
      entryPrice: setup.entry,
      stopLoss: setup.stopLoss,
      targets: setup.targets,
      confidenceScore,
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

    // Modified timeframe priority to only consider 15m and 5m
    const timeframePriority: Record<string, number> = {
      '15m': 2,
      '5m': 1
    };

    return patterns.sort((a, b) => {
      // First by pattern priority
      const priorityDiff = patternPriority[b.type] - patternPriority[a.type];
      if (priorityDiff !== 0) return priorityDiff;
      
      // Then by timeframe (only 15m and 5m)
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
    // All patterns must align with market structure
    if (pattern.direction === 'bullish' && structure.trend === 'downtrend') {
      console.log('\x1b[33m⚠️ Pattern rejected: Bullish pattern in downtrend\x1b[0m');
      return false;
    }
    if (pattern.direction === 'bearish' && structure.trend === 'uptrend') {
      console.log('\x1b[33m⚠️ Pattern rejected: Bearish pattern in uptrend\x1b[0m');
      return false;
    }

    // Validate pattern-specific criteria
    switch (pattern.type) {
      case 'BOS':
      case 'ChoCH':
        // These are trend reversal patterns, require strong confirmation
        const recentSwings = structure.swings
          .filter(s => s.timestamp > pattern.timestamp - (24 * 60 * 60 * 1000))
          .slice(-3);
        
        if (pattern.direction === 'bullish') {
          const hasHigherLows = recentSwings.some(s => s.type === 'HL');
          if (!hasHigherLows) {
            console.log('\x1b[33m⚠️ BOS/ChoCH rejected: No higher lows confirmation\x1b[0m');
            return false;
          }
        } else {
          const hasLowerHighs = recentSwings.some(s => s.type === 'LH');
          if (!hasLowerHighs) {
            console.log('\x1b[33m⚠️ BOS/ChoCH rejected: No lower highs confirmation\x1b[0m');
            return false;
          }
        }
        break;

      case 'LiquidityGrab':
        // Require nearby key level and strong volume
        const nearbyLevel = structure.keyLevels.find(level => 
          Math.abs(level.price - pattern.price) / pattern.price < 0.003 &&
          level.strength >= 0.7 // Require strong level
        );
        if (!nearbyLevel) {
          console.log('\x1b[33m⚠️ Liquidity grab rejected: No strong nearby level\x1b[0m');
          return false;
        }
        break;

      case 'OrderBlock':
        // Validate order block with volume and previous price action
        const hasVolume = pattern.confidence > 0.8; // Order blocks should have strong volume
        const hasKeyLevel = structure.keyLevels.some(level => 
          Math.abs(level.price - pattern.price) / pattern.price < 0.005 &&
          level.type === (pattern.direction === 'bullish' ? 'support' : 'resistance')
        );
        if (!hasVolume || !hasKeyLevel) {
          console.log('\x1b[33m⚠️ Order block rejected: Insufficient volume or key level support\x1b[0m');
          return false;
        }
        break;

      case 'FairValueGap':
        // FVGs need strong momentum and clean price action
        const hasCleanPA = structure.keyLevels.every(level => 
          Math.abs(level.price - pattern.price) / pattern.price > 0.005
        );
        if (!hasCleanPA) {
          console.log('\x1b[33m⚠️ FVG rejected: Messy price action nearby\x1b[0m');
          return false;
        }
        break;
    }

    return true;
  }

  private calculateTradeSetup(
    mainPattern: SMCPattern,
    analysis: SMCAnalysis,
    data5m: Candle[],
    symbol: string
  ): { entry: number; stopLoss: number; targets: number[]; riskRewardRatio: number; } | null {
    // Only allow 5m and 15m timeframe patterns
    if (mainPattern.timeframe !== '5m' && mainPattern.timeframe !== '15m') {
      console.log(`\x1b[33m⚠️ Pattern rejected: Invalid timeframe ${mainPattern.timeframe} (only 5m and 15m allowed)\x1b[0m`);
      return null;
    }

    // Check if pattern is too old (more than 24 hours)
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    if (mainPattern.timestamp < oneDayAgo) {
      console.log(`\x1b[33m⚠️ Pattern rejected: Too old (more than 24 hours)\x1b[0m`);
      return null;
    }

    const entry = mainPattern.price;
    const currentPrice = data5m[data5m.length - 1].close;
    
    // Calculate dynamic threshold based on timeframe and volatility
    const last20Candles = data5m.slice(-20);
    const volatility = this.analysisService.calculateVolatility(last20Candles);
    let priceThreshold = 0.005; // Base threshold 0.5%
    
    if (volatility > 0.015) {
      priceThreshold = volatility * 2; // Increased multiplier
    }
    
    // Check if current price is within threshold of entry price
    const priceDiff = Math.abs(currentPrice - entry) / entry;
    if (priceDiff > priceThreshold) {
      // Queue the setup instead of rejecting it
      this.queueManager.queueSetup({
        symbol,
        pattern: mainPattern,
        analysis,
        entryPrice: entry,
        queueTime: Date.now(),
        expiryTime: Date.now() + (6 * 60 * 60 * 1000), // Increased to 6 hours expiry
        priceThreshold: {
          min: entry * (1 - priceThreshold),
          max: entry * (1 + priceThreshold)
        }
      });
      
      console.log(`\x1b[33m⚠️ Trade setup queued: Current price ${currentPrice.toFixed(8)} is too far from entry price ${entry.toFixed(8)} (${(priceDiff * 100).toFixed(2)}% difference)\x1b[0m`);
      return null;
    }
    
    // Enhanced stop loss calculation
    let stopLoss: number;
    
    // Find multiple swing levels for stop loss consideration
    const relevantSwings = analysis.marketStructure.swings
      .filter(swing => {
        const isValidDirection = mainPattern.direction === 'bullish' ? 
          swing.price < entry : swing.price > entry;
        const isRecentEnough = swing.timestamp > oneDayAgo;
        return isValidDirection && isRecentEnough;
      })
      .sort((a, b) => Math.abs(entry - a.price) - Math.abs(entry - b.price));

    if (relevantSwings.length === 0) {
      // Fallback to using a percentage-based stop loss if no valid swings found
      const stopDistance = volatility * 2;
      stopLoss = mainPattern.direction === 'bullish' ? 
        entry * (1 - stopDistance) : 
        entry * (1 + stopDistance);
      console.log('\x1b[33m⚠️ Using fallback percentage-based stop loss\x1b[0m');
    } else {
      // Use nearest swing for tighter stop loss
      stopLoss = relevantSwings[0].price;
    }

    // Validate minimum stop loss distance
    const stopLossDistance = Math.abs(entry - stopLoss) / entry;
    const minStopDistance = Math.max(volatility * 1.2, 0.008); // Reduced from 1.5x to 1.2x volatility and minimum from 1% to 0.8%
    
    if (stopLossDistance < minStopDistance) {
      console.log(`\x1b[33m⚠️ Stop loss too close to entry (${(stopLossDistance * 100).toFixed(2)}% vs required ${(minStopDistance * 100).toFixed(2)}%)\x1b[0m`);
      return null;
    }

    // Find targets using key levels with strength validation
    const targets = analysis.keyLevels
      .filter(level => {
        const isValidDirection = mainPattern.direction === 'bullish' ? 
          level.price > entry : level.price < entry;
        const hasGoodStrength = level.strength >= 0.5; // Reduced from 0.6 to 0.5
        return isValidDirection && hasGoodStrength;
      })
      .sort((a, b) => mainPattern.direction === 'bullish' ? 
        a.price - b.price : b.price - a.price)
      .slice(0, 3)
      .map(level => level.price);

    if (targets.length < 1) { // Reduced from 2 to 1 minimum target
      console.log('\x1b[33m⚠️ Not enough valid target levels found\x1b[0m');
      return null;
    }

    const riskRewardRatio = Math.abs(targets[0] - entry) / Math.abs(stopLoss - entry);
    // Reduced minimum RR ratio
    if (riskRewardRatio < 1.5) { // Reduced from 2 to 1.5
      console.log(`\x1b[33m⚠️ Risk-reward ratio too low: ${riskRewardRatio.toFixed(2)} (minimum 1.5 required)\x1b[0m`);
      return null;
    }

    return { entry, stopLoss, targets, riskRewardRatio };
  }

  private calculateConfidenceScore(patterns: SMCPattern[], analysis: SMCAnalysis): number {
    let score = patterns[0].confidence;
    const aPlus = this.isAPlusSetup(patterns[0], patterns, analysis);

    // Boost confidence for A+ setups
    if (aPlus.isAPlus) {
      score = Math.min(score + 0.2, 1);
      console.log('\x1b[32m🌟 A+ Setup Detected!\x1b[0m');
      aPlus.reasons.forEach(reason => {
        console.log(`\x1b[32m${reason}\x1b[0m`);
      });
    }

    // Additional confidence boosts
    if (patterns.length > 1) {
      score += 0.1 * (patterns.length - 1);
    }

    if (patterns[0].direction === 'bullish' && analysis.marketStructure.trend === 'uptrend' ||
        patterns[0].direction === 'bearish' && analysis.marketStructure.trend === 'downtrend') {
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

  private isAPlusSetup(
    mainPattern: SMCPattern,
    patterns: SMCPattern[],
    analysis: SMCAnalysis
  ): { isAPlus: boolean; reasons: string[] } {
    const reasons: string[] = [];
    let criteriaCount = 0;

    // 1. Higher Timeframe Alignment
    if (mainPattern.timeframe === '4h' || mainPattern.timeframe === '1h') {
      if ((mainPattern.direction === 'bullish' && analysis.marketStructure.trend === 'uptrend') ||
          (mainPattern.direction === 'bearish' && analysis.marketStructure.trend === 'downtrend')) {
        criteriaCount++;
        reasons.push('✅ Higher timeframe alignment');
      }
    }

    // 2. Multiple Pattern Confluence
    const confluencePatterns = patterns.filter(p => 
      Math.abs(p.price - mainPattern.price) / mainPattern.price < 0.003 && // Within 0.3%
      p.direction === mainPattern.direction &&
      p !== mainPattern
    );
    if (confluencePatterns.length >= 1) {
      criteriaCount++;
      reasons.push(`✅ Pattern confluence: ${confluencePatterns.map(p => p.type).join(', ')}`);
    }

    // 3. Key Level Confluence
    const nearbyKeyLevels = analysis.keyLevels.filter(level => 
      Math.abs(level.price - mainPattern.price) / mainPattern.price < 0.003
    );
    if (nearbyKeyLevels.length > 0) {
      criteriaCount++;
      reasons.push('✅ Key level confluence');
    }

    // 4. Strong Pattern Types
    if (['BOS', 'ChoCH'].includes(mainPattern.type)) {
      criteriaCount++;
      reasons.push('✅ High-priority pattern type');
    }

    // 5. Liquidity Presence
    const hasLiquidity = analysis.liquidityLevels.some(level => 
      (mainPattern.direction === 'bullish' && level.type === 'buy' ||
       mainPattern.direction === 'bearish' && level.type === 'sell') &&
      Math.abs(level.price - mainPattern.price) / mainPattern.price < 0.005
    );
    if (hasLiquidity) {
      criteriaCount++;
      reasons.push('✅ Liquidity presence confirmed');
    }

    // A+ setup requires at least 4 out of 5 criteria
    const isAPlus = criteriaCount >= 4;
    
    if (!isAPlus) {
      const missingCriteria = 5 - criteriaCount;
      reasons.push(`❌ Missing ${missingCriteria} key criteria for A+ rating`);
    }

    return { isAPlus, reasons };
  }

  /**
   * Get all currently queued setups for a symbol
   */
  public getQueuedSetups(symbol: string): QueuedTradeSetup[] {
    return this.queueManager.getQueuedSetups(symbol);
  }

  /**
   * Clear queued setups for a symbol
   */
  public clearQueuedSetups(symbol: string): void {
    this.queueManager.clearSymbolQueue(symbol);
  }
} 