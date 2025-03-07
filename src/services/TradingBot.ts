import { BinanceService } from './BinanceService';
import { OpenAIService } from './OpenAIService';
import { DatabaseService, TradingProgress } from './DatabaseService';
import { MarketAnalysisService } from './MarketAnalysisService';
import { TradingPlan } from '../types/trading';
import { Interval } from '@binance/connector-typescript';

export class TradingBot {
  private binanceService: BinanceService;
  private openAIService: OpenAIService;
  private dbService: DatabaseService;
  private marketAnalysisService: MarketAnalysisService;

  constructor() {
    this.binanceService = new BinanceService(
      process.env.BINANCE_API_KEY!,
      process.env.BINANCE_API_SECRET!
    );

    this.openAIService = new OpenAIService(
      process.env.OPENAI_PROJECT_ID!,
      process.env.OPENAI_API_KEY!
    );

    this.dbService = new DatabaseService();
    this.marketAnalysisService = new MarketAnalysisService();
  }

  async startMonitoring(symbol: string, interval: Interval) {
    try {
      // Fetch market data
      const marketData = await this.binanceService.fetchMarketData(symbol, interval);
      
      // Get market metrics
      const marketMetrics = await this.binanceService.getMarketMetrics(symbol);
      
      // Analyze market conditions
      const marketAnalysis = this.marketAnalysisService.analyzeMarket(
        symbol,
        marketData.last100Candles,
        marketData.indicators,
        marketMetrics.marketCap,
        marketMetrics.dominance
      );

      // Get AI trading plan
      const tradingPlan = await this.openAIService.getTradingPlan(marketData);

      console.log('Market Analysis:', JSON.stringify(marketAnalysis, null, 2));
      console.log('Trading Plan:', JSON.stringify(tradingPlan, null, 2));

      // Validate the plan against our risk management rules
      const isValidPlan = this.validateTradingPlan(tradingPlan, marketAnalysis, marketData.interval);

      if (!isValidPlan) {
        console.log('Trading plan rejected due to risk management rules');
        await this.storePlan(symbol, interval, tradingPlan, marketAnalysis, TradingProgress.SKIPPED);
        return;
      }

      // Store the trading plan with market conditions
      await this.storePlan(symbol, interval, tradingPlan, marketAnalysis, TradingProgress.IN_PROGRESS);

      // Get the latest plan from the database to verify storage
      const latestPlan = await this.dbService.getLatestTradingPlan(symbol, interval);
      console.log('Latest Trading Plan:', JSON.stringify(latestPlan, null, 2));

      // Calculate success rate for this symbol
      const successRate = await this.dbService.getSuccessRate(symbol);
      console.log(`Success rate for ${symbol}: ${successRate.toFixed(2)}%`);

    } catch (error) {
      console.error('Error in monitoring loop:', error);
      throw error;
    }
  }

  async recheckLastPlan(symbol: string, interval: string): Promise<void> {
    try {
      // Get the latest plan
      const latestPlan = await this.dbService.getLatestTradingPlan(symbol, interval);
      console.log('Latest Trading Plan:', JSON.stringify(latestPlan, null, 2));
      
      if (!latestPlan) {
        console.log('No existing trading plan found for', symbol);
        return;
      }

      if (latestPlan.progress === TradingProgress.SKIPPED) {
        console.log('Latest plan was skipped');
        return;
      }

      // Fetch current market data
      const marketData = await this.binanceService.fetchMarketData(symbol, interval as Interval);
      
      // Validate if the plan is still valid under current conditions
      const isStillValid = await this.openAIService.validateTradingConditions(latestPlan, marketData);

      console.log('Plan recheck result:', isStillValid ? 'Still valid' : 'No longer valid');
      
      if (!isStillValid) {
        // Mark the plan as skipped if it's no longer valid
        await this.updateTradingProgress(latestPlan.id, TradingProgress.SKIPPED, undefined, 'Plan invalidated by market conditions');
        console.log('Previous plan marked as skipped due to changed market conditions');
      } else {
        console.log('Plan is still valid, waiting for trade conditions');
      }
    } catch (error) {
      console.error('Error rechecking last plan:', error);
      throw error;
    }
  }

  private validateTradingPlan(plan: TradingPlan, marketAnalysis: any, interval: string): boolean {
    // Check risk-reward ratio
    if (plan.riskRewardRatio >= 2 && plan.riskRewardRatio < marketAnalysis.riskManagement.riskRewardRatio) {
      console.log('Risk-reward ratio too low');
      return false;
    }

    // Validate position size
    if (plan.positionSize > marketAnalysis.riskManagement.recommendedPositionSize) {
      console.log('Position size too large');
      return false;
    }

    // Validate max loss
    if (plan.maxLossPercentage > marketAnalysis.riskManagement.maxLossPercentage) {
      console.log('Maximum loss percentage exceeded');
      return false;
    }

    // Validate confidence score
    if (plan.confidenceScore < 70) {
      console.log('Confidence score too low');
      return false;
    }

    // Validate market conditions
    if (marketAnalysis.marketCondition.volatility === 'high' && plan.positionSize > 3) {
      console.log('Position size too large for high volatility');
      return false;
    }

    // Validate timeframe matches interval
    if (plan.timeframe !== interval) {
      console.log('Timeframe does not match the analyzed interval');
      return false;
    }

    return true;
  }

  private async storePlan(
    symbol: string,
    interval: string,
    plan: TradingPlan,
    marketAnalysis: any,
    progress: TradingProgress
  ) {
    await this.dbService.storeTradingPlan(
      symbol,
      interval,
      plan,
      marketAnalysis.marketCondition,
      plan.entryPrice,
      plan.confidenceScore,
      plan.riskRewardRatio,
      plan.positionSize,
      plan.maxLossPercentage
    );
  }

  async updateTradingProgress(planId: number, progress: TradingProgress, profitLoss?: number, notes?: string) {
    await this.dbService.updateTradingPlanProgress(planId, progress);
    
    if (progress === TradingProgress.TRADED && profitLoss !== undefined) {
      await this.dbService.updateTradeProfitLoss(planId, profitLoss, notes);
    }
  }

  async cleanup() {
    await this.dbService.close();
  }
} 