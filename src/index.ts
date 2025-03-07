import { Interval } from '@binance/connector-typescript';
import * as dotenv from 'dotenv';
import { TradingBot } from './services/TradingBot';

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

// Usage example
async function main() {
  const bot = new TradingBot();
  try {
    await bot.recheckLastPlan('LTCUSDT', Interval['15m']);
    // await bot.startMonitoring('LTCUSDT', Interval['15m']);
  } finally {
    await bot.cleanup();
  }
}

main().catch(console.error); 