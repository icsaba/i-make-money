import { Interval, Spot } from '@binance/connector-typescript';
import { TradingPlan } from '../types/trading';
import { SMCTradingBot } from '../bots/SMCTradingBot';
import { SMCWalletService } from '../services/SMCWalletService';
import { DatabaseService } from '../services/DatabaseService';
import chalk = require('chalk');

/**
 * Manager for the SMC Trading Bot that handles periodic scanning
 * and trade management across multiple symbols
 */
export class SMCTradingManager {
  private smcBot: SMCTradingBot;
  private binanceClient: Spot;
  private activeSymbols: string[];
  private interval: number;
  private walletService: SMCWalletService;
  private monitorIntervals: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;
  private currentPrices: Map<string, number> = new Map();
  private priceUpdateInterval: NodeJS.Timeout | null = null;
  private dbService: DatabaseService;

  /**
   * Creates a new instance of SMCTradingManager
   * @param binanceClient The Binance Spot client (optional)
   * @param symbols Array of trading pairs to monitor
   * @param intervalMinutes Interval in minutes between scans (default: 5)
   */
  constructor(
    binanceClient?: Spot,
    symbols: string[] = ['BTCUSDT', 'ETHUSDT'],
    intervalMinutes: number = 5
  ) {
    if (binanceClient) {
      this.binanceClient = binanceClient;
    } else {
      // Initialize with environment variables if not provided
      this.binanceClient = new Spot(
        process.env.BINANCE_API_KEY!,
        process.env.BINANCE_API_SECRET!
      );
    }
    
    this.dbService = new DatabaseService();
    this.walletService = new SMCWalletService(this.dbService.getDatabase());
    this.smcBot = new SMCTradingBot(this.binanceClient);
    this.activeSymbols = symbols;
    this.interval = intervalMinutes * 60 * 1000;
  }

  /**
   * Start the trading manager
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Trading manager is already running');
      return;
    }

    await this.dbService.initializeDatabase();
    await this.walletService.initializeWallet();

    this.isRunning = true;
    console.log('Starting SMC Trading Manager...');
    console.log(`Monitoring symbols: ${this.activeSymbols.join(', ')}`);
    console.log(`Scan interval: ${this.interval / 60000} minutes`);
    
    // Start price updates
    await this.updateCurrentPrices();
    this.priceUpdateInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.updateCurrentPrices();
      }
    }, 5000);
    
    // Initial scan
    await this.scanMarkets();
    
    // Set up periodic scanning
    const scanInterval = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(scanInterval);
        return;
      }
      
      await this.scanMarkets();
    }, this.interval);

    console.log('SMC Trading Manager started successfully');
  }

  /**
   * Stop the trading manager
   */
  stop(): void {
    console.log('Stopping SMC Trading Manager...');
    this.isRunning = false;
    
    // Clear all monitoring intervals
    this.monitorIntervals.forEach((interval) => {
      clearInterval(interval);
    });
    
    // Clear price update interval
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }
    
    this.monitorIntervals.clear();
    console.log('SMC Trading Manager stopped');
  }

  /**
   * Add a symbol to the monitoring list
   * @param symbol The trading pair to add
   */
  addSymbol(symbol: string): void {
    if (!this.activeSymbols.includes(symbol)) {
      this.activeSymbols.push(symbol);
      console.log(`Added ${symbol} to monitoring list`);
    }
  }

  /**
   * Remove a symbol from the monitoring list
   * @param symbol The trading pair to remove
   */
  removeSymbol(symbol: string): void {
    const index = this.activeSymbols.indexOf(symbol);
    if (index !== -1) {
      this.activeSymbols.splice(index, 1);
      
      // Clear monitoring interval if exists
      const monitorInterval = this.monitorIntervals.get(symbol);
      if (monitorInterval) {
        clearInterval(monitorInterval);
        this.monitorIntervals.delete(symbol);
      }
      
      console.log(`Removed ${symbol} from monitoring list`);
    }
  }

  /**
   * Get the current status of all monitored symbols
   */
  async getStatus(): Promise<Record<string, { isActive: boolean }>> {
    const activeTradesMap = await this.walletService.getActiveTradesBySymbols(this.activeSymbols);
    const status: Record<string, { isActive: boolean }> = {};
    
    this.activeSymbols.forEach(symbol => {
      status[symbol] = {
        isActive: activeTradesMap.get(symbol) || false
      };
    });
    
    return status;
  }

  /**
   * Scan all symbols for trading opportunities
   * @private
   */
  private async scanMarkets(): Promise<void> {
    try {
      console.log(`[${new Date().toISOString()}] Scanning markets for SMC setups...`);
      
      const activeTradesMap = await this.walletService.getActiveTradesBySymbols(this.activeSymbols);
      
      for (const symbol of this.activeSymbols) {
        // Skip if we already have an active trade for this symbol
        if (activeTradesMap.get(symbol)) {
          console.log(`  - Skipping ${symbol} - Active trade in progress`);
          continue;
        }

        console.log(`  - Analyzing ${symbol}...`);
        const tradingPlan = await this.smcBot.analyzeSMC(symbol);

        if (tradingPlan) {
          console.log(`  ✓ Found trading setup for ${symbol}:`, {
            direction: tradingPlan.direction,
            entry: tradingPlan.entryPrice,
            stopLoss: tradingPlan.stopLoss,
            targets: tradingPlan.targets,
            confidence: tradingPlan.confidenceScore,
            timeframe: tradingPlan.timeframe
          });

          // Execute the trading plan
          await this.executeTradingPlan(symbol, tradingPlan);
        } else {
          console.log(`  - No valid setup found for ${symbol}`);
        }
      }
      
      console.log(`Scan completed. Next scan in ${this.interval / 60000} minutes`);
    } catch (error) {
      console.error('Error in market scan:', error);
    }
  }

  /**
   * Execute a trading plan for a symbol
   * @param symbol The trading pair
   * @param plan The trading plan to execute
   * @private
   */
  private async executeTradingPlan(symbol: string, plan: TradingPlan): Promise<void> {
    try {
      console.log(`Executing trading plan for ${symbol}:`);
      console.log(`  - Direction: ${plan.direction}`);
      console.log(`  - Entry price: ${plan.entryPrice}`);
      console.log(`  - Stop loss: ${plan.stopLoss}`);
      console.log(`  - Targets: ${plan.targets.join(', ')}`);
      console.log(`  - Position size: ${plan.positionSize}`);
      
      // Record the trade in the wallet service
      const tradeId = await this.walletService.recordTrade({
        symbol,
        direction: plan.direction,
        entry: plan.entryPrice,
        stopLoss: plan.stopLoss,
        target: plan.targets[0], // Using first target
        confidence: plan.confidenceScore,
        positionSize: plan.positionSize,
        timeframe: plan.timeframe,
        enterDate: new Date()
      });
      
      // Here you would implement order placement logic
      // For example:
      // await this.placeEntryOrder(symbol, plan);
      // await this.placeStopLossOrder(symbol, plan);
      // await this.placeTakeProfitOrders(symbol, plan);
      
      // For now, we'll just log
      console.log(`  ✓ Orders would be placed (simulation)`);
      
      // Monitor the trade
      this.monitorTrade(symbol, plan);
    } catch (error) {
      console.error(`Error executing trade for ${symbol}:`, error);
    }
  }

  /**
   * Monitor an active trade
   * @param symbol The trading pair
   * @param plan The trading plan being monitored
   * @private
   */
  private async monitorTrade(symbol: string, plan: TradingPlan): Promise<void> {
    console.log(`Starting trade monitor for ${symbol}`);
    
    // Clear any existing monitoring interval
    if (this.monitorIntervals.has(symbol)) {
      clearInterval(this.monitorIntervals.get(symbol)!);
    }
    
    // Set up new monitoring interval
    const checkInterval = setInterval(async () => {
      try {
        if (!this.isRunning) {
          clearInterval(checkInterval);
          return;
        }
        
        // Get current price from our cached prices
        const currentPrice = this.currentPrices.get(symbol);
        if (!currentPrice) {
          return; // Skip if price not available
        }
        
        const tradeId = await this.walletService.getActiveTradeId(symbol);
        if (!tradeId) {
          clearInterval(checkInterval);
          return;
        }
        
        // Check if stop loss hit
        if (this.isStopLossHit(currentPrice, plan)) {
          console.log(chalk.red(`[${symbol}] Stop loss hit at ${currentPrice}`));
          await this.completeTrade(symbol, tradeId, currentPrice, plan, 'Stop loss');
          clearInterval(checkInterval);
          return;
        }
        
        // Check if any target hit
        const targetHit = this.isTargetHit(currentPrice, plan);
        if (targetHit !== -1) {
          console.log(chalk.green(`[${symbol}] Target ${targetHit + 1} hit at ${currentPrice}`));
          await this.completeTrade(symbol, tradeId, currentPrice, plan, `Target ${targetHit + 1}`);
          clearInterval(checkInterval);
          return;
        }
        
      } catch (error) {
        console.error(`Error monitoring trade for ${symbol}:`, error);
      }
    }, 1000); // Check every second
    
    // Store the interval
    this.monitorIntervals.set(symbol, checkInterval);
  }

  /**
   * Complete a trade and record the result
   * @param symbol The trading pair
   * @param tradeId The trade ID
   * @param currentPrice The current price
   * @param plan The trading plan
   * @param reason The reason for completion
   * @private
   */
  private async completeTrade(
    symbol: string,
    tradeId: number,
    currentPrice: number,
    plan: TradingPlan,
    reason: string
  ): Promise<void> {
    const profitLoss = plan.direction === 'long'
      ? (currentPrice - plan.entryPrice) * plan.positionSize
      : (plan.entryPrice - currentPrice) * plan.positionSize;

    await this.walletService.closeTrade(tradeId, profitLoss, reason);
    
    console.log(chalk.blue(`Trade completed for ${symbol}. Reason: ${reason}`));
    console.log(chalk.blue(`Profit/Loss: ${profitLoss > 0 ? '+' : ''}${profitLoss.toFixed(2)} USD`));
    console.log(chalk.blue(`${symbol} is now available for new setups`));
  }

  /**
   * Check if stop loss level has been hit
   * @param currentPrice The current price
   * @param plan The trading plan
   * @private
   */
  private isStopLossHit(currentPrice: number, plan: TradingPlan): boolean {
    return plan.direction === 'long' 
      ? currentPrice <= plan.stopLoss 
      : currentPrice >= plan.stopLoss;
  }

  /**
   * Check if any target level has been hit
   * @param currentPrice The current price
   * @param plan The trading plan
   * @returns The index of the hit target or -1 if none
   * @private
   */
  private isTargetHit(currentPrice: number, plan: TradingPlan): number {
    if (plan.direction === 'long') {
      for (let i = 0; i < plan.targets.length; i++) {
        if (currentPrice >= plan.targets[i]) {
          return i;
        }
      }
    } else {
      for (let i = 0; i < plan.targets.length; i++) {
        if (currentPrice <= plan.targets[i]) {
          return i;
        }
      }
    }
    
    return -1;
  }

  /**
   * Update current prices for all monitored symbols
   * @private
   */
  private async updateCurrentPrices(): Promise<void> {
    try {
      for (const symbol of this.activeSymbols) {
        try {
          // Get latest candle data for current price
          const klines = await this.binanceClient.uiklines(symbol, Interval['1m'], { limit: 1 });
          if (klines && klines.length > 0) {
            // Use close price of most recent candle
            const price = parseFloat(String(klines[0][4]));
            this.currentPrices.set(symbol, price);
          }
        } catch (error) {
          console.error(`Error updating price for ${symbol}:`, error);
        }
      }
    } catch (error) {
      console.error('Error updating prices:', error);
    }
  }
} 