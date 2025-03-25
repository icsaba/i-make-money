import { Candle, TradingPlan, SMCPattern, MarketStructure, SMCAnalysis, PatternType, TradeDirection, TradingData, LiquidityLevel } from '../types/trading';
import { SMCAnalysisService } from '../services/SMCAnalysisService';
import { TradeQueueManager, QueuedTradeSetup } from '../services/TradeQueueManager';
import { BinanceService } from '../services/BinanceService';

export class SMCTradingBot {
  private binanceService: BinanceService;
  private analysisService: SMCAnalysisService;
  private queueManager: TradeQueueManager;

  constructor(apiKey: string, apiSecret: string) {
    this.binanceService = new BinanceService(apiKey, apiSecret);
    this.analysisService = new SMCAnalysisService();
    this.queueManager = new TradeQueueManager();
  }

  /**
   * Get the latest price for a symbol
   * @param symbol The trading pair symbol (e.g., BTCUSDT)
   * @returns The latest price data
   */
  public async getLatestPrice(symbol: string): Promise<{ price: number }> {
    const data = await this.binanceService.fetchMarketData(symbol, '1m');
    const lastCandle = data.last100Candles[data.last100Candles.length - 1];
    return { price: lastCandle.close };
  }

  async analyzeSMC(symbol: string): Promise<TradingPlan | null> {
    try {
      // Get data for all timeframes
      const data4h = await this.binanceService.fetchMarketData(symbol, '4h');
      const data1h = await this.binanceService.fetchMarketData(symbol, '1h');
      const data15m = await this.binanceService.fetchMarketData(symbol, '15m');
      const data5m = await this.binanceService.fetchMarketData(symbol, '5m');

      // Analyze market structure on higher timeframes for context only
      const analysis = await this.analyzeMarket(data4h, data1h, data15m, data5m);
      
      // Find patterns ONLY on 5m and 15m timeframes
      const patterns = [
        ...await this.findPatternsOnTimeframe(data5m.last100Candles, '5m'),
        ...await this.findPatternsOnTimeframe(data15m.last100Candles, '15m')
      ];

      // Find high confidence patterns
      const highConfidencePatterns = patterns.filter(p => p.confidence > 0.7);
      if (highConfidencePatterns.length === 0) {
        console.log('\x1b[33m⚠️ No high confidence patterns found\x1b[0m');
        return null;
      }

      // Sort patterns by priority and confidence
      const sortedPatterns = this.prioritizePatterns(highConfidencePatterns);
      if (!sortedPatterns.length) return null;

      // Get the highest priority pattern
      const mainPattern = sortedPatterns[0];

      // Validate pattern alignment with market structure
      if (!this.validatePatternAlignment(mainPattern, analysis.marketStructure)) {
        return null;
      }

      // Calculate trade setup
      const setup = this.calculateTradeSetup(mainPattern, analysis, data5m.last100Candles, symbol);
      if (!setup) {
        return null;
      }

      // Calculate confidence score and check for A+ setup
      const { isAPlus, reasons: aPlusReasons } = this.calculateConfidenceScore(sortedPatterns, analysis);

      return {
        direction: this.mapDirectionToTradeDirection(mainPattern.direction),
        entryPrice: setup.entry,
        stopLoss: setup.stopLoss,
        targets: setup.targets,
        confidenceScore: isAPlus ? 1 : 0.7,
        timeframe: mainPattern.timeframe,
        positionSize: 1,
        maxLossPercentage: 1,
        riskRewardRatio: setup.riskRewardRatio,
        entryConditions: this.generateEntryConditions(sortedPatterns, analysis),
        exitConditions: this.generateExitConditions(setup),
        tradingPatterns: sortedPatterns.map(p => p.type),
        isAPlusSetup: isAPlus,
        aPlusReasons,
        marketContext: {
          trend: analysis.marketStructure.trend,
          keyLevels: analysis.marketStructure.keyLevels.map(l => l.price),
          liquidityLevels: analysis.liquidityLevels
        }
      };
    } catch (error) {
      console.error('Error analyzing SMC:', error);
      throw error;
    }
  }

  private mapDirectionToTradeDirection(direction: 'bullish' | 'bearish'): TradeDirection {
    return direction === 'bullish' ? 'long' : 'short';
  }

  private prioritizePatterns(patterns: SMCPattern[]): SMCPattern[] {
    const patternPriority: Record<PatternType, number> = {
      'BOS': 5,
      'ChoCH': 4,
      'LiquidityGrab': 3,
      'OrderBlock': 2,
      'FairValueGap': 1,
      'BreakerBlock': 2,
      'Imbalance': 1
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
    // Validate pattern-specific criteria
    switch (pattern.type) {
      case 'BOS':
      case 'ChoCH':
        return this.validateReversalPattern(pattern, structure);
      
      case 'LiquidityGrab':
        return this.validateLiquidityGrab(pattern, structure);
      
      case 'OrderBlock':
      case 'BreakerBlock':
        return this.validateBlock(pattern, structure);
      
      case 'FairValueGap':
      case 'Imbalance':
        return this.validateImbalance(pattern, structure);
      
      default:
        return false;
    }
  }

  private validateReversalPattern(pattern: SMCPattern, structure: MarketStructure): boolean {
    if (!pattern.validation.volumeConfirmation) {
      console.log('\x1b[33m⚠️ Reversal pattern rejected: Insufficient volume\x1b[0m');
      return false;
    }

    if (!pattern.validation.marketStructureAlignment) {
      console.log('\x1b[33m⚠️ Reversal pattern rejected: Not aligned with market structure\x1b[0m');
      return false;
    }

    // Check for clean break with no immediate retrace
    if (!pattern.priceAction.cleanBreak || pattern.priceAction.immediateRetrace) {
      console.log('\x1b[33m⚠️ Reversal pattern rejected: No clean break or immediate retrace\x1b[0m');
      return false;
    }

    return true;
  }

  private validateLiquidityGrab(pattern: SMCPattern, structure: MarketStructure): boolean {
    // Volume must be significantly higher than average
    if (pattern.volume < pattern.averageVolume * 1.5) {
      console.log('\x1b[33m⚠️ Liquidity grab rejected: Insufficient volume spike\x1b[0m');
      return false;
    }

    // Must have strong reversal after the grab
    if (!pattern.priceAction.strongReversal) {
      console.log('\x1b[33m⚠️ Liquidity grab rejected: No strong reversal\x1b[0m');
      return false;
    }

    // Must be near a key level
    const nearKeyLevel = structure.keyLevels.some(level => 
      Math.abs(level.price - pattern.price) / pattern.price < 0.003 &&
      level.strength >= 0.7
    );

    if (!nearKeyLevel) {
      console.log('\x1b[33m⚠️ Liquidity grab rejected: No strong nearby level\x1b[0m');
      return false;
    }

    return true;
  }

  private validateBlock(pattern: SMCPattern, structure: MarketStructure): boolean {
    // Must have strong volume
    if (!pattern.validation.volumeConfirmation) {
      console.log('\x1b[33m⚠️ Block pattern rejected: Insufficient volume\x1b[0m');
      return false;
    }

    // Must be at a key level
    const atKeyLevel = structure.keyLevels.some(level => 
      Math.abs(level.price - pattern.price) / pattern.price < 0.005 &&
      level.type === (pattern.direction === 'bullish' ? 'support' : 'resistance')
    );

    if (!atKeyLevel) {
      console.log('\x1b[33m⚠️ Block pattern rejected: Not at key level\x1b[0m');
      return false;
    }

    return true;
  }

  private validateImbalance(pattern: SMCPattern, structure: MarketStructure): boolean {
    // Must have clean price action
    if (!pattern.priceAction.cleanBreak) {
      console.log('\x1b[33m⚠️ Imbalance rejected: No clean break\x1b[0m');
      return false;
    }

    // Must not have immediate retrace
    if (pattern.priceAction.immediateRetrace) {
      console.log('\x1b[33m⚠️ Imbalance rejected: Immediate retrace present\x1b[0m');
      return false;
    }

    // Must align with market structure
    if (!pattern.validation.marketStructureAlignment) {
      console.log('\x1b[33m⚠️ Imbalance rejected: Not aligned with market structure\x1b[0m');
      return false;
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

  private calculateConfidenceScore(patterns: SMCPattern[], analysis: SMCAnalysis): { isAPlus: boolean; reasons: string[] } {
    let score = patterns[0].confidence;
    const reasons: string[] = [];
    let criteriaCount = 0;

    // 1. Higher Timeframe Alignment
    const htfAlignment = this.checkHigherTimeframeAlignment(patterns[0], analysis);
    if (htfAlignment.aligned) {
      criteriaCount++;
      reasons.push(`✅ Higher timeframe alignment: ${htfAlignment.reason}`);
    }

    // 2. Multiple Pattern Confluence
    const confluencePatterns = patterns.filter(p => 
      Math.abs(p.price - patterns[0].price) / patterns[0].price < 0.003 && 
      p.direction === patterns[0].direction &&
      p !== patterns[0]
    );
    if (confluencePatterns.length >= 1) {
      criteriaCount++;
      reasons.push(`✅ Pattern confluence: ${confluencePatterns.map(p => p.type).join(', ')}`);
    }

    // 3. Volume Confirmation
    if (patterns[0].volume > patterns[0].averageVolume * 1.5) {
      criteriaCount++;
      reasons.push('✅ Strong volume confirmation');
    }

    // 4. Clean Price Action
    if (patterns[0].priceAction.cleanBreak && !patterns[0].priceAction.immediateRetrace) {
      criteriaCount++;
      reasons.push('✅ Clean price action with no immediate retrace');
    }

    // 5. Key Level Confluence
    const nearbyKeyLevels = analysis.keyLevels.filter(level => 
      Math.abs(level.price - patterns[0].price) / patterns[0].price < 0.003 &&
      level.strength >= 0.7
    );
    if (nearbyKeyLevels.length > 0) {
      criteriaCount++;
      reasons.push('✅ Strong key level confluence');
    }

    // 6. Market Structure Alignment
    if (patterns[0].validation.marketStructureAlignment) {
      criteriaCount++;
      reasons.push('✅ Aligned with market structure');
    }

    // 7. Liquidity Presence
    const hasLiquidity = analysis.liquidityLevels.some(level => 
      (patterns[0].direction === 'bullish' && level.type === 'buy' ||
       patterns[0].direction === 'bearish' && level.type === 'sell') &&
      Math.abs(level.price - patterns[0].price) / patterns[0].price < 0.005 &&
      level.stopCluster
    );
    if (hasLiquidity) {
      criteriaCount++;
      reasons.push('✅ Premium liquidity level present');
    }

    // A+ setup requires at least 5 out of 7 criteria
    const isAPlus = criteriaCount >= 5;
    
    if (!isAPlus) {
      const missingCriteria = 5 - criteriaCount;
      reasons.push(`❌ Missing ${missingCriteria} key criteria for A+ rating`);
    }

    return { isAPlus, reasons };
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

  private checkHigherTimeframeAlignment(
    pattern: SMCPattern,
    analysis: SMCAnalysis
  ): { aligned: boolean; reason: string } {
    // Check market structure alignment
    const htfTrend = analysis.marketStructure.trend;
    const patternDirection = pattern.direction;

    // Check recent swings on higher timeframes
    const recentSwings = analysis.marketStructure.swings
      .filter(s => s.timestamp > pattern.timestamp - (24 * 60 * 60 * 1000))
      .slice(-3);

    if (patternDirection === 'bullish') {
      const hasHigherLows = recentSwings.some(s => s.type === 'HL');
      const trendAligned = htfTrend === 'uptrend';

      if (trendAligned && hasHigherLows) {
        return { 
          aligned: true, 
          reason: 'Bullish pattern aligned with uptrend and higher lows' 
        };
      }
    } else {
      const hasLowerHighs = recentSwings.some(s => s.type === 'LH');
      const trendAligned = htfTrend === 'downtrend';

      if (trendAligned && hasLowerHighs) {
        return { 
          aligned: true, 
          reason: 'Bearish pattern aligned with downtrend and lower highs' 
        };
      }
    }

    return { aligned: false, reason: 'No higher timeframe alignment' };
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

  private async findPatternsOnTimeframe(candles: Candle[], timeframe: string): Promise<SMCPattern[]> {
    const patterns: SMCPattern[] = [];
    const patternTypes: PatternType[] = ['BOS', 'ChoCH', 'LiquidityGrab', 'OrderBlock', 'FairValueGap', 'BreakerBlock', 'Imbalance'];

    for (const type of patternTypes) {
      const foundPatterns = this.analysisService.findPatterns(candles, timeframe, type);
      patterns.push(...foundPatterns);
    }

    return patterns;
  }

  private async analyzeMarket(data4h: TradingData, data1h: TradingData, data15m: TradingData, data5m: TradingData): Promise<SMCAnalysis> {
    try {
      // Analyze market structure using higher timeframe data only
      const marketStructure = this.analysisService.analyzeMarketStructure(data4h.last100Candles);

      // Find patterns on each timeframe
      const patterns: SMCPattern[] = [];
      const timeframes = [
        { data: data4h, interval: '4h' },
        { data: data1h, interval: '1h' },
        { data: data15m, interval: '15m' },
        { data: data5m, interval: '5m' }
      ];

      for (const { data, interval } of timeframes) {
        const timeframePatterns = await this.findPatternsOnTimeframe(data.last100Candles, interval);
        patterns.push(...timeframePatterns);
      }

      // Sort patterns by priority and confidence
      const sortedPatterns = this.prioritizePatterns(patterns);

      // Get liquidity levels with all required properties
      const liquidityLevels = this.analysisService.findLiquidityLevels(data4h.last100Candles);

      return {
        marketStructure,
        patterns: sortedPatterns,
        liquidityLevels,
        orderBlocks: sortedPatterns.filter(p => p.type === 'OrderBlock'),
        keyLevels: marketStructure.keyLevels.map(l => ({
          price: l.price,
          type: l.type,
          strength: l.strength
        }))
      };
    } catch (error) {
      console.error('Error analyzing market:', error);
      throw error;
    }
  }
} 