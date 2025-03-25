import { Database } from 'sqlite3';

export interface Trade {
  id?: number;
  symbol: string;
  direction: string;
  entry: number;
  stopLoss: number;
  target: number;
  confidence: number;
  positionSize: number;
  profitLoss?: number;
  timeframe: string;
  enterDate: Date;
  exitDate?: Date;
  reason?: string;
}

export class SMCWalletService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async initializeWallet(): Promise<void> {
    const sql = `
      INSERT OR IGNORE INTO wallet (id, balance, position_size)
      VALUES (1, 10000, 0.2)
    `;

    return new Promise<void>((resolve, reject) => {
      this.db.run(sql, (err) => {
        if (err) {
          console.error('Error initializing wallet:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getBalance(): Promise<number> {
    const sql = 'SELECT balance FROM wallet WHERE id = 1';

    return new Promise((resolve, reject) => {
      this.db.get(sql, (err, row: { balance: number }) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.balance);
        }
      });
    });
  }

  async getPositionSize(): Promise<number> {
    const sql = 'SELECT position_size FROM wallet WHERE id = 1';

    return new Promise((resolve, reject) => {
      this.db.get(sql, (err, row: { position_size: number }) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.position_size);
        }
      });
    });
  }

  async updateBalance(newBalance: number): Promise<void> {
    const sql = `
            UPDATE wallet 
            SET balance = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = 1
        `;

    return new Promise<void>((resolve, reject) => {
      this.db.run(sql, [newBalance], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async recordTrade(trade: Trade): Promise<number> {
    const sql = `
      INSERT INTO trades (
          symbol, direction, entry, stopLoss, target,
          confidence, positionSize, timeframe, enterDate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    return new Promise((resolve, reject) => {
      this.db.run(
        sql,
        [
          trade.symbol,
          trade.direction,
          trade.entry,
          trade.stopLoss,
          trade.target,
          trade.confidence,
          trade.positionSize,
          trade.timeframe,
          trade.enterDate.toISOString()
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }

  async closeTrade(tradeId: number, profitLoss: number, reason?: string): Promise<void> {
    const sql = `
      UPDATE trades 
      SET profitLoss = ?,
          exitDate = CURRENT_TIMESTAMP,
          reason = ?
      WHERE id = ?
    `;

    return new Promise<void>((resolve, reject) => {
      this.db.run(sql, [profitLoss, reason || null, tradeId], async (err) => {
        if (err) {
          reject(err);
        } else {
          // Update wallet balance
          const currentBalance = await this.getBalance();
          await this.updateBalance(currentBalance + profitLoss);
          resolve();
        }
      });
    });
  }

  async getActiveTrades(): Promise<Trade[]> {
    const sql = `
      SELECT * FROM trades 
      WHERE exitDate IS NULL 
      ORDER BY enterDate DESC
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, (err, rows: Trade[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(row => ({
            ...row,
            enterDate: new Date(row.enterDate),
            exitDate: row.exitDate ? new Date(row.exitDate) : undefined
          })));
        }
      });
    });
  }

  async hasActiveTrade(symbol: string): Promise<boolean> {
    const sql = `
      SELECT COUNT(*) as count 
      FROM trades 
      WHERE symbol = ? AND exitDate IS NULL
    `;

    return new Promise((resolve, reject) => {
      this.db.get(sql, [symbol], (err, row: { count: number }) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count > 0);
        }
      });
    });
  }

  async getActiveTradesBySymbols(symbols: string[]): Promise<Map<string, boolean>> {
    const activeTradesMap = new Map<string, boolean>();

    // Initialize all symbols as false
    symbols.forEach(symbol => activeTradesMap.set(symbol, false));

    const sql = `
      SELECT symbol 
      FROM trades 
      WHERE symbol IN (${symbols.map(() => '?').join(',')}) 
      AND exitDate IS NULL
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, symbols, (err, rows: { symbol: string }[]) => {
        if (err) {
          reject(err);
        } else {
          // Update map for symbols with active trades
          rows.forEach(row => activeTradesMap.set(row.symbol, true));
          resolve(activeTradesMap);
        }
      });
    });
  }

  async getActiveTradeId(symbol: string): Promise<number | null> {
    const sql = `
      SELECT id 
      FROM trades 
      WHERE symbol = ? AND exitDate IS NULL 
      ORDER BY enterDate DESC 
      LIMIT 1
    `;

    return new Promise((resolve, reject) => {
      this.db.get(sql, [symbol], (err, row: { id: number } | undefined) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? row.id : null);
        }
      });
    });
  }
} 