import * as sqlite3 from 'sqlite3';
import { Database } from 'sqlite3';

export enum TradingProgress {
  IN_PROGRESS = 'IN_PROGRESS',
  SKIPPED = 'SKIPPED',
  TRADED = 'TRADED',
  CLOSED = 'CLOSED'
}

export interface MarketCondition {
  trend: 'bullish' | 'bearish' | 'sideways';
  volatility: 'high' | 'medium' | 'low';
  volume: 'high' | 'medium' | 'low';
  marketCap: number;
  dominance?: number;  // for crypto
}

interface TradingPlanRow {
  plan: string;
  progress: TradingProgress;
  market_condition: string;
  entry_price: number;
  confidence_score: number;
  risk_reward_ratio: number;
  position_size: number;
  max_loss_percentage: number;
}

export class DatabaseService {
  private db: Database;

  constructor() {
    this.db = new sqlite3.Database('trading.db', (err: Error | null) => {
      if (err) {
        console.error('Error opening database:', err);
      } else {
        console.log('Connected to SQLite database');
        this.initializeDatabase();
      }
    });
  }

  private async initializeDatabase() {
    const createTable = `
      CREATE TABLE IF NOT EXISTS trading_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        plan TEXT NOT NULL,
        progress TEXT NOT NULL DEFAULT '${TradingProgress.IN_PROGRESS}',
        market_condition TEXT NOT NULL,
        entry_price REAL,
        confidence_score INTEGER NOT NULL,
        risk_reward_ratio REAL NOT NULL,
        position_size REAL NOT NULL,
        max_loss_percentage REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        executed_at DATETIME,
        closed_at DATETIME,
        actual_profit_loss REAL,
        success_rate REAL,
        notes TEXT
      )
    `;

    return new Promise<void>((resolve, reject) => {
      this.db.run(createTable, (err) => {
        if (err) {
          console.error('Error creating table:', err);
          reject(err);
        } else {
          console.log('Trading plans table initialized');
          resolve();
        }
      });
    });
  }

  async storeTradingPlan(
    symbol: string, 
    interval: string, 
    plan: any, 
    marketCondition: MarketCondition,
    entryPrice: number,
    confidenceScore: number,
    riskRewardRatio: number,
    positionSize: number,
    maxLossPercentage: number
  ): Promise<void> {
    const sql = `
      INSERT INTO trading_plans (
        symbol, interval, plan, progress, market_condition, 
        entry_price, confidence_score, risk_reward_ratio, 
        position_size, max_loss_percentage
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    return new Promise<void>((resolve, reject) => {
      this.db.run(
        sql, 
        [
          symbol, 
          interval, 
          JSON.stringify(plan), 
          TradingProgress.IN_PROGRESS,
          JSON.stringify(marketCondition),
          entryPrice,
          confidenceScore,
          riskRewardRatio,
          positionSize,
          maxLossPercentage
        ], 
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  async updateTradeProfitLoss(id: number, profitLoss: number, notes?: string): Promise<void> {
    const sql = `
      UPDATE trading_plans 
      SET actual_profit_loss = ?, 
          closed_at = CURRENT_TIMESTAMP,
          notes = ?
      WHERE id = ?
    `;
    
    return new Promise<void>((resolve, reject) => {
      this.db.run(sql, [profitLoss, notes || null, id], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async updateTradingPlanProgress(id: number, progress: TradingProgress): Promise<void> {
    const sql = `
      UPDATE trading_plans 
      SET progress = ?,
          executed_at = CASE WHEN ? = '${TradingProgress.TRADED}' THEN CURRENT_TIMESTAMP ELSE executed_at END
      WHERE id = ?
    `;
    
    return new Promise<void>((resolve, reject) => {
      this.db.run(sql, [progress, progress, id], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getSuccessRate(symbol: string): Promise<number> {
    const sql = `
      SELECT 
        COUNT(CASE WHEN actual_profit_loss > 0 THEN 1 END) * 100.0 / COUNT(*) as success_rate
      FROM trading_plans 
      WHERE symbol = ? 
        AND progress = ? 
        AND actual_profit_loss IS NOT NULL
    `;

    return new Promise((resolve, reject) => {
      this.db.get(sql, [symbol, TradingProgress.TRADED], (err: Error | null, row: { success_rate: number }) => {
        if (err) {
          reject(err);
        } else {
          resolve(row?.success_rate || 0);
        }
      });
    });
  }

  async getLatestTradingPlan(symbol: string, interval: string): Promise<any | null> {
    const sql = `
      SELECT 
        id, plan, progress, market_condition, entry_price,
        confidence_score, risk_reward_ratio, position_size,
        max_loss_percentage, created_at, executed_at, closed_at,
        actual_profit_loss, notes
      FROM trading_plans 
      WHERE symbol = ? AND interval = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `;

    return new Promise((resolve, reject) => {
      this.db.get(sql, [symbol, interval], (err: Error | null, row: TradingPlanRow & { id: number } | undefined) => {
        if (err) {
          reject(err);
        } else {
          if (!row) return resolve(null);
          const result = {
            id: row.id,
            progress: row.progress,
            marketCondition: JSON.parse(row.market_condition),
            entryPrice: row.entry_price,
            confidenceScore: row.confidence_score,
            riskRewardRatio: row.risk_reward_ratio,
            positionSize: row.position_size,
            maxLossPercentage: row.max_loss_percentage,
            ...JSON.parse(row.plan)
          };
          resolve(result);
        }
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
} 