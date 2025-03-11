import { Interval, Spot } from '@binance/connector-typescript';
import { TradingPlan } from '../types/trading';
import { SMCTradingBot } from '../bots/SMCTradingBot';

/**
 * Manager for the SMC Trading Bot that handles periodic scanning
 * and trade management across multiple symbols
 */
export class SMCTradingManager {
  private smcBot: SMCTradingBot;
  private binanceClient: Spot;
  private activeSymbols: string[];
  private interval: number;
  private activeTrades: Map<string, boolean> = new Map();
  private monitorIntervals: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;
  private currentPrices: Map<string, number> = new Map();
  private priceUpdateInterval: NodeJS.Timeout | null = null;

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

    this.isRunning = true;
    console.log('Starting SMC Trading Manager...');
    console.log(`Monitoring symbols: ${this.activeSymbols.join(', ')}`);
    console.log(`Scan interval: ${this.interval / 60000} minutes`);
    
    // Initialize active trades map
    this.activeSymbols.forEach(symbol => {
      this.activeTrades.set(symbol, false);
    });
    
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
      this.activeTrades.set(symbol, false);
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
      this.activeTrades.delete(symbol);
      
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
  getStatus(): Record<string, { isActive: boolean }> {
    const status: Record<string, { isActive: boolean }> = {};
    
    this.activeSymbols.forEach(symbol => {
      status[symbol] = {
        isActive: this.activeTrades.get(symbol) || false
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
      
      for (const symbol of this.activeSymbols) {
        // Skip if we already have an active trade for this symbol
        if (this.activeTrades.get(symbol)) {
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

          // Mark symbol as having active trade
          this.activeTrades.set(symbol, true);

          // Handle the trading plan
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
      this.activeTrades.set(symbol, false); // Reset active trade flag
    }
  }

  /**
   * Monitor an active trade
   * @param symbol The trading pair
   * @param plan The trading plan being monitored
   * @private
   */
  private monitorTrade(symbol: string, plan: TradingPlan): void {
    console.log(`Starting trade monitor for ${symbol}`);
    
    // Clear any existing monitoring interval
    if (this.monitorIntervals.has(symbol)) {
      clearInterval(this.monitorIntervals.get(symbol)!);
    }
    
    // Set up new monitoring interval
    const checkInterval = setInterval(() => {
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
        
        // Check if stop loss hit
        if (this.isStopLossHit(currentPrice, plan)) {
          console.log(`[${symbol}] Stop loss hit at ${currentPrice}`);
          this.completeTrade(symbol, checkInterval, 'Stop loss');
          return;
        }
        
        // Check if any target hit
        const targetHit = this.isTargetHit(currentPrice, plan);
        if (targetHit !== -1) {
          console.log(`[${symbol}] Target ${targetHit + 1} hit at ${currentPrice}`);
          this.completeTrade(symbol, checkInterval, `Target ${targetHit + 1}`);
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
   * Complete a trade and reset monitoring
   * @param symbol The trading pair
   * @param checkInterval The interval to clear
   * @param reason The reason for completion
   * @private
   */
  private completeTrade(symbol: string, checkInterval: NodeJS.Timeout, reason: string): void {
    clearInterval(checkInterval);
    this.monitorIntervals.delete(symbol);
    this.activeTrades.set(symbol, false);
    
    console.log(`Trade completed for ${symbol}. Reason: ${reason}`);
    console.log(`${symbol} is now available for new setups`);
    
    // Here you would implement any trade completion logic:
    // - Record trade result in database
    // - Send notifications
    // - Update performance metrics
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