import { BinanceService } from './services/BinanceService';
import { OpenAIService } from './services/OpenAIService';
import { DatabaseService, TradingProgress, MarketCondition } from './services/DatabaseService';
import { MarketAnalysisService } from './services/MarketAnalysisService';
import { TradingPlan, MarketMetrics } from './types/trading';
import { Interval } from '@binance/connector-typescript';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'BINANCE_API_KEY',
  'BINANCE_API_SECRET',
  'OPENAI_PROJECT_ID',
  'OPENAI_API_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

class TradingBot {
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
      console.log('trading plan:', JSON.stringify(tradingPlan, null, 2));

      // Validate the plan against our risk management rules
      const isValidPlan = this.validateTradingPlan(tradingPlan, marketAnalysis);

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
    }
  }

  private validateTradingPlan(plan: TradingPlan, marketAnalysis: any): boolean {
    // Check risk-reward ratio
    if (plan.riskRewardRatio < marketAnalysis.riskManagement.riskRewardRatio) {
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

// Usage example
async function main() {
  const bot = new TradingBot();
  try {
    await bot.startMonitoring('LTCUSDT', Interval['15m']);
  } finally {
    await bot.cleanup();
  }
}

main().catch(console.error); 