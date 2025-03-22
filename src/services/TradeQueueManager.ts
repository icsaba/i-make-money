import { SMCPattern, SMCAnalysis } from '../types/trading';

export interface QueuedTradeSetup {
  symbol: string;
  pattern: SMCPattern;
  analysis: SMCAnalysis;
  entryPrice: number;
  queueTime: number;
  expiryTime: number;
  priceThreshold: {
    min: number;
    max: number;
  };
}

export class TradeQueueManager {
  private queuedSetups: Map<string, QueuedTradeSetup[]> = new Map();
  private readonly MAX_QUEUED_SETUPS_PER_SYMBOL = 10;

  /**
   * Queue a potential trade setup for later evaluation
   */
  public queueSetup(setup: QueuedTradeSetup): void {
    const symbolQueue = this.queuedSetups.get(setup.symbol) || [];
    
    // Remove expired setups first
    this.cleanExpiredSetups(setup.symbol);
    
    // Check if a similar setup already exists
    const similarSetupExists = symbolQueue.some(existing => 
      Math.abs(existing.entryPrice - setup.entryPrice) / setup.entryPrice < 0.003 &&
      existing.pattern.type === setup.pattern.type &&
      existing.pattern.direction === setup.pattern.direction
    );

    if (!similarSetupExists) {
      // Add new setup while maintaining max queue size
      symbolQueue.push(setup);
      if (symbolQueue.length > this.MAX_QUEUED_SETUPS_PER_SYMBOL) {
        symbolQueue.shift(); // Remove oldest setup if queue is full
      }
      this.queuedSetups.set(setup.symbol, symbolQueue);
      console.log(`\x1b[36m📋 Trade setup queued for ${setup.symbol} at ${setup.entryPrice}\x1b[0m`);
    }
  }

  /**
   * Check queued setups for a symbol against current price
   */
  public checkQueuedSetups(symbol: string, currentPrice: number): QueuedTradeSetup[] {
    const symbolQueue = this.queuedSetups.get(symbol) || [];
    if (symbolQueue.length === 0) return [];

    // Clean expired setups first
    this.cleanExpiredSetups(symbol);
    
    // Find valid setups based on current price
    const validSetups = symbolQueue.filter(setup => 
      currentPrice >= setup.priceThreshold.min &&
      currentPrice <= setup.priceThreshold.max
    );

    if (validSetups.length > 0) {
      // Remove triggered setups from queue
      this.queuedSetups.set(
        symbol,
        symbolQueue.filter(setup => !validSetups.includes(setup))
      );
      
      console.log(`\x1b[32m✨ Found ${validSetups.length} valid setup(s) for ${symbol} at current price ${currentPrice}\x1b[0m`);
    }

    return validSetups;
  }

  /**
   * Remove expired setups for a symbol
   */
  private cleanExpiredSetups(symbol: string): void {
    const symbolQueue = this.queuedSetups.get(symbol) || [];
    const now = Date.now();
    
    const validSetups = symbolQueue.filter(setup => setup.expiryTime > now);
    if (validSetups.length !== symbolQueue.length) {
      this.queuedSetups.set(symbol, validSetups);
      console.log(`\x1b[33m🧹 Cleaned ${symbolQueue.length - validSetups.length} expired setup(s) for ${symbol}\x1b[0m`);
    }
  }

  /**
   * Get all queued setups for a symbol
   */
  public getQueuedSetups(symbol: string): QueuedTradeSetup[] {
    return this.queuedSetups.get(symbol) || [];
  }

  /**
   * Clear all queued setups for a symbol
   */
  public clearSymbolQueue(symbol: string): void {
    this.queuedSetups.delete(symbol);
    console.log(`\x1b[33m🗑️ Cleared queue for ${symbol}\x1b[0m`);
  }

  /**
   * Clear all queued setups
   */
  public clearAllQueues(): void {
    this.queuedSetups.clear();
    console.log('\x1b[33m🗑️ Cleared all queued setups\x1b[0m');
  }
} 